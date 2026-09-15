import { z } from 'zod/v4'

// Folding a commit's ref decorations into one entry per ref *identity*.
//
// `git log %d` decorates a commit once per ref, so a branch that agrees with
// its remotes arrives as several entries — `HEAD -> main`, `origin/main`,
// `upstream/main` — naming one fact three times. Grouping them is pure
// data-in/data-out over `commit.refs`, and every surface that renders ref pills
// (the graph rows, the commit detail panel, and the nightshift-ui host that
// embeds both) needs the identical answer, so it lives here rather than inside
// a component (ADR-0026/ADR-0032).
//
// Refs only ever group when they decorate the *same* commit, because that is
// the whole input: one commit's decorations. A local branch that has diverged
// from its remote therefore decorates a different commit and keeps its own
// pill — the "you have unpushed commits" signal stays legible, and there is no
// way for this to claim a sync git did not report. Per-commit decorations can
// say "same commit or not" and nothing more; ahead/behind counts would need
// `%(upstream:track)` on the branch listing, which is why the shape below
// leaves room for them (ADR-0029) rather than pretending to know.

export const RefGroupKindSchema = z
  .enum(['head', 'branch', 'remote', 'tag'])
  .describe(
    'What the grouped ref is: a detached HEAD pointer, a local branch (which may also ' +
      'exist on remotes), a ref that exists only on remotes, or a tag.',
  )
export type RefGroupKind = z.infer<typeof RefGroupKindSchema>

export const RefGroupSchema = z.object({
  // `kind` and `name` are the group's identity, so they stay defaultless and
  // fail loudly (ADR-0029); everything below them grows with a default.
  kind: RefGroupKindSchema,
  name: z
    .string()
    .min(1)
    .describe(
      'Bare ref name with git decoration syntax removed — `main` for both `HEAD -> main` ' +
        'and `origin/main`, `v1.0` for `tag: v1.0`, `HEAD` for a detached HEAD.',
    ),
  isHead: z
    .boolean()
    .default(false)
    .describe('True when HEAD points at this ref — the branch is the checked-out one.'),
  remotes: z
    .array(z.string())
    .default([])
    .describe(
      'Names of the remotes whose tracking ref for this name decorates the same commit, ' +
        'sorted. Empty for a local-only branch, a tag, and HEAD.',
    ),
  decorations: z
    .array(z.string())
    .default([])
    .describe('The raw `%d` entries folded into this group, in the order git listed them.'),
})
export type RefGroup = z.infer<typeof RefGroupSchema>

// git's own decoration syntax: a tag is prefixed, and the checked-out branch is
// pointed at by HEAD.
const TAG_PREFIX = /^tag:\s*/
const HEAD_POINTER = /^HEAD\s*->\s*/
// `%d` normally prints remote-tracking refs short (`origin/main`), but a
// repository configured to print them long says `remotes/origin/main`. Both
// mean the same ref.
const REMOTES_PREFIX = 'remotes/'
// Remote names are arbitrary, so classification needs the repository's own list
// (the server reads it from `git for-each-ref refs/remotes`). When a caller has
// no list — an older host that does not pass one yet — fall back to the one
// remote name git itself creates by default, which is strictly better than
// classifying `origin/main` as a local branch.
const FALLBACK_REMOTE_NAME = 'origin'

/**
 * Which of `remoteNames` a short remote-tracking ref belongs to, or null when
 * none does. Longest match first: a remote may legally be named with a slash
 * (`fork/alice`), and only the longest match splits `fork/alice/main` into the
 * right remote and the right branch.
 */
function matchRemoteName(shortRef: string, remoteNames: readonly string[]): string | null {
  const byLengthDescending = [...remoteNames].sort(
    (first, second) => second.length - first.length,
  )
  for (const remoteName of byLengthDescending) {
    const prefix = `${remoteName}/`
    if (shortRef.startsWith(prefix) && shortRef.length > prefix.length) return remoteName
  }
  return null
}

/** The remote name a `remotes/`-prefixed ref belongs to when no configured name matches. */
function leadingSegment(shortRef: string): string | null {
  const separatorIndex = shortRef.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === shortRef.length - 1) return null
  return shortRef.slice(0, separatorIndex)
}

/** One decoration, classified — the per-entry half of {@link groupRefDecorations}. */
export type ClassifiedRefDecoration =
  | { kind: 'tag'; name: string }
  | { kind: 'head' }
  | { kind: 'branch'; name: string; isHead: boolean }
  | { kind: 'remote'; name: string; remote: string }

/**
 * Classify a single `%d` entry against the repository's remote names. This is
 * what replaces guessing at an `origin/` prefix: a remote-tracking ref is one
 * whose leading segments name a remote git itself reported, so `feature/main`
 * stays the local branch it is and `fork/main` is recognised as a remote ref
 * when `fork` is a remote.
 */
export function classifyRefDecoration(
  decoration: string,
  remoteNames: readonly string[] = [],
): ClassifiedRefDecoration | null {
  const trimmed = decoration.trim()
  if (!trimmed) return null
  if (TAG_PREFIX.test(trimmed)) {
    const tagName = trimmed.replace(TAG_PREFIX, '')
    return tagName ? { kind: 'tag', name: tagName } : null
  }

  const isHead = HEAD_POINTER.test(trimmed)
  const pointee = trimmed.replace(HEAD_POINTER, '')
  // A bare `HEAD` is the detached pointer itself, not a branch. When HEAD is
  // detached on a commit that also carries branches, git lists both — and they
  // must not merge, because HEAD is not on any of them.
  if (pointee === 'HEAD') return { kind: 'head' }

  if (pointee.startsWith(REMOTES_PREFIX)) {
    const shortRef = pointee.slice(REMOTES_PREFIX.length)
    const remoteName = matchRemoteName(shortRef, remoteNames) ?? leadingSegment(shortRef)
    if (remoteName !== null) {
      return { kind: 'remote', name: shortRef.slice(remoteName.length + 1), remote: remoteName }
    }
  }

  const configuredRemote = matchRemoteName(pointee, remoteNames)
  const remoteName =
    configuredRemote ??
    (remoteNames.length === 0 ? matchRemoteName(pointee, [FALLBACK_REMOTE_NAME]) : null)
  if (remoteName !== null) {
    return { kind: 'remote', name: pointee.slice(remoteName.length + 1), remote: remoteName }
  }

  return { kind: 'branch', name: pointee, isHead }
}

/**
 * The group key a classified decoration merges on. A local branch and a
 * remote-tracking ref of the same name share one key, which is the whole point;
 * a tag never shares one, so `tag: v1.0` is never folded into the pill of a
 * branch that happens to be called `v1.0`.
 */
function groupKey(classified: ClassifiedRefDecoration): string {
  if (classified.kind === 'tag') return `tag:${classified.name}`
  if (classified.kind === 'head') return 'head'
  return `branch:${classified.name}`
}

/**
 * Group one commit's `%d` decorations into one {@link RefGroup} per ref
 * identity, in the order git first named them. Given `['HEAD -> main',
 * 'origin/main', 'upstream/main', 'tag: v1.0']` and the remotes `['origin',
 * 'upstream']` this yields two groups: the checked-out branch `main` agreeing
 * with both remotes, and the tag.
 */
export function groupRefDecorations(
  decorations: readonly string[],
  remoteNames: readonly string[] = [],
): RefGroup[] {
  const groups: RefGroup[] = []
  const groupByKey = new Map<string, RefGroup>()

  for (const decoration of decorations) {
    const classified = classifyRefDecoration(decoration, remoteNames)
    if (classified === null) continue

    const key = groupKey(classified)
    const existing = groupByKey.get(key)
    if (existing === undefined) {
      const group: RefGroup = {
        kind: classified.kind,
        name: classified.kind === 'head' ? 'HEAD' : classified.name,
        isHead: classified.kind === 'head' || (classified.kind === 'branch' && classified.isHead),
        remotes: classified.kind === 'remote' ? [classified.remote] : [],
        decorations: [decoration.trim()],
      }
      groups.push(group)
      groupByKey.set(key, group)
      continue
    }

    existing.decorations.push(decoration.trim())
    if (classified.kind === 'remote') {
      if (!existing.remotes.includes(classified.remote)) existing.remotes.push(classified.remote)
      continue
    }
    if (classified.kind === 'branch') {
      // A local ref at this commit turns a so-far remote-only group into the
      // local branch it belongs to, keeping the remotes that already joined.
      existing.kind = 'branch'
      if (classified.isHead) existing.isHead = true
    }
  }

  // git lists a commit's decorations in its own order, which puts `upstream/main`
  // before `origin/main` in one repository and after it in the next. A set of
  // remotes has no inherent order, so sort it — otherwise the same pill reads
  // differently from one repository to another.
  for (const group of groups) {
    group.remotes.sort((first, second) => first.localeCompare(second))
  }

  return groups
}

/** What a ref pill prints for a group: the ref itself, plus the remotes to mark. */
export type RefGroupLabel = {
  /** The ref's text, without the HEAD marker — also what a user means by "copy this ref". */
  text: string
  /**
   * Remotes to name in the synced marker beside the text, or empty when there
   * is nothing to mark.
   */
  markerRemotes: string[]
}

/**
 * The display parts of a group. A ref that exists on exactly one remote and
 * nowhere locally is not "in sync" with anything — it is simply that remote's
 * branch, so it keeps the qualified name git printed (`origin/feature`) and
 * carries no marker, exactly as it rendered before grouping existed.
 */
export function refGroupLabel(group: RefGroup): RefGroupLabel {
  const [onlyRemote] = group.remotes
  if (group.kind === 'remote' && group.remotes.length === 1 && onlyRemote !== undefined) {
    return { text: `${onlyRemote}/${group.name}`, markerRemotes: [] }
  }
  return { text: group.name, markerRemotes: [...group.remotes] }
}

/** The qualified remote-tracking names a group agrees with: `origin/main, upstream/main`. */
const qualifiedRemoteRefs = (group: RefGroup) =>
  group.remotes.map((remoteName) => `${remoteName}/${group.name}`).join(', ')

/**
 * The pill's tooltip: what this group actually is, spelled out. A unified pill
 * merges two facts into one badge, so the hover has to say which refs went in —
 * otherwise the marker is a claim the reader cannot check.
 */
export function refGroupTitle(group: RefGroup): string {
  switch (group.kind) {
    case 'tag':
      return `tag ${group.name}`
    case 'head':
      return 'detached HEAD — no branch is checked out at this commit'
    case 'remote':
      return group.remotes.length > 1
        ? `${group.name} on ${qualifiedRemoteRefs(group)} — no local branch`
        : `remote-tracking branch ${qualifiedRemoteRefs(group)} — no local branch`
    case 'branch': {
      const checkedOut = group.isHead ? ' (checked out)' : ''
      return group.remotes.length === 0
        ? `local branch ${group.name}${checkedOut} — no remote-tracking ref at this commit`
        : `local branch ${group.name}${checkedOut} — in sync with ${qualifiedRemoteRefs(group)}`
    }
  }
}
