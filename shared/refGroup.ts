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
// git's ref *shortening* (`%(refname:short)`, `git branch` output) prints a
// remote-tracking ref long — `remotes/origin/main` — when a local branch of the
// same name would make the short form ambiguous. `%d`/`%D` do not disambiguate
// (they print `origin/main` twice), so this form does not arrive from the commit
// log; it is recognised because the same grouping runs over ref listings that do
// shorten. Either way it only counts as remote when what follows names a remote
// git itself reported — `remotes/` is a naming convention, not a proof.
const REMOTES_PREFIX = 'remotes/'

/**
 * Which of `remoteNames` a short remote-tracking ref belongs to, or null when
 * none does — the longest match wins, because a remote may legally be named
 * with a slash (`git remote add fork/alice …` is accepted) and only the longest
 * match splits `fork/alice/main` into the right remote and the right branch.
 * The server produces these names with `git remote`, which is the only listing
 * that knows a multi-segment name; `refs/remotes/fork/alice/main` alone cannot
 * be re-split into one.
 *
 * `remoteNames` is the repository's own list and there is no fallback guess
 * anywhere in this module: an empty list is git's authoritative answer that the
 * repository has no remote-tracking refs, so a decoration that merely *looks*
 * like `origin/<something>` — or like `remotes/<something>/<something>` — is a
 * local branch there, and claiming otherwise would invent a remote, and then a
 * sync with it, that does not exist.
 */
function matchRemoteName(shortRef: string, remoteNames: readonly string[]): string | null {
  let longestMatch: string | null = null
  for (const remoteName of remoteNames) {
    const prefix = `${remoteName}/`
    if (!shortRef.startsWith(prefix) || shortRef.length <= prefix.length) continue
    if (longestMatch === null || remoteName.length > longestMatch.length) longestMatch = remoteName
  }
  return longestMatch
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
 *
 * `remoteNames` is required, with no default: it is the repository's own
 * `CommitLog.remotes`/`CommitDetail.remotes`, and a defaulted parameter would
 * make "the caller passed nothing" indistinguishable from "git reported no
 * remotes" — the one case where a guess produces a sync claim about a ref that
 * does not exist.
 */
export function classifyRefDecoration(
  decoration: string,
  remoteNames: readonly string[],
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
  // `HEAD -> x` is git saying HEAD is *on* x, which it only ever is for a local
  // branch. That settles the one case the short `%d` form cannot: a local branch
  // literally named `origin/other` prints exactly like the remote-tracking ref
  // `refs/remotes/origin/other`, and reading it as remote would both drop its
  // HEAD marker and let it collect remotes it has nothing to do with.
  if (isHead) return { kind: 'branch', name: pointee, isHead: true }

  if (pointee.startsWith(REMOTES_PREFIX)) {
    const shortRef = pointee.slice(REMOTES_PREFIX.length)
    // Only a configured remote makes this remote-tracking. Reading the leading
    // segment as the remote instead would be the fallback guess this module
    // says it does not make: in a repository with no remotes, the local branch
    // `remotes/foo/bar` (git accepts the name, and prints it exactly like this)
    // would be read as `foo`'s branch `bar`, and a sibling local branch `bar`
    // would then fold it in and claim a sync with `foo/bar` — a ref that exists
    // nowhere. Falling through hands the whole name to the branch case below,
    // which is what it is.
    const remoteName = matchRemoteName(shortRef, remoteNames)
    if (remoteName !== null) {
      return { kind: 'remote', name: shortRef.slice(remoteName.length + 1), remote: remoteName }
    }
  }

  const remoteName = matchRemoteName(pointee, remoteNames)
  if (remoteName !== null) {
    return { kind: 'remote', name: pointee.slice(remoteName.length + 1), remote: remoteName }
  }

  return { kind: 'branch', name: pointee, isHead: false }
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
 *
 * `remoteNames` is required for the reason given on {@link classifyRefDecoration}:
 * an empty list must mean "this repository has no remotes", never "nobody told
 * me".
 */
export function groupRefDecorations(
  decorations: readonly string[],
  remoteNames: readonly string[],
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
   * Remotes to append to the chip as further segments of the same pill, or
   * empty when the ref names itself alone. (The name predates the redesign that
   * turned a separate marker into in-chip segments; it is part of this module's
   * public shape, so renaming it is its own change.)
   */
  markerRemotes: string[]
}

/**
 * The display parts of a group. A ref that exists on exactly one remote and
 * nowhere locally is not "in sync" with anything — it is simply that remote's
 * branch, so it keeps the qualified name git printed (`origin/feature`) and
 * gains no segments, exactly as it rendered before grouping existed.
 */
export function refGroupLabel(group: RefGroup): RefGroupLabel {
  const [onlyRemote] = group.remotes
  if (group.kind === 'remote' && group.remotes.length === 1 && onlyRemote !== undefined) {
    return { text: `${onlyRemote}/${group.name}`, markerRemotes: [] }
  }
  return { text: group.name, markerRemotes: [...group.remotes] }
}

/**
 * The ref a copy button should hand the user: always a name that resolves in
 * the repository, which is not always the name the pill prints.
 *
 * `refGroupLabel` drops the remote qualifier for a ref that lives on *several*
 * remotes and nowhere locally (`origin/shared` + `upstream/shared` print as
 * `shared` with two segments), because the pill's subject is the shared name.
 * A bare `shared` resolves to nothing, so copying the label would hand over a
 * ref git cannot look up. Qualifying with the first remote — the same one the
 * single-remote pill already prints in full — always names a real ref. Whether
 * the *pill* should stay unqualified there is a separate, open question; this
 * function is deliberately independent of it so the answer can change without
 * the copy value going wrong again.
 */
export function refGroupCopyValue(group: RefGroup): string {
  const [firstRemote] = group.remotes
  if (group.kind === 'remote' && firstRemote !== undefined) {
    return `${firstRemote}/${group.name}`
  }
  // A tag, a local branch (with or without remotes) and a detached `HEAD` all
  // resolve under their own name.
  return group.name
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
