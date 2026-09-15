import type { GitCommit } from './git.schema'

// The `git log` wire format this service produces and parses. Fields are
// separated by the ASCII unit separator (0x1f) — unlike `|` in the original
// prototype it cannot appear in commit subjects written by any sane tool, and
// the parser still tolerates it if it does (the subject is the tail join).
export const FIELD_SEPARATOR = '\x1f'

// %h hash · %p parents · %d ref decorations · %an author · %ad date · %s subject
export const COMMIT_LOG_PRETTY_FORMAT = ['%h', '%p', '%d', '%an', '%ad', '%s'].join('%x1f')

export const COMMIT_LOG_ARGUMENTS = [
  'log',
  '--all',
  '--topo-order',
  `--pretty=format:${COMMIT_LOG_PRETTY_FORMAT}`,
  '--date=short',
  // `%d` honours `log.decorate`, and a user with `log.decorate=full` in their
  // config gets `refs/heads/main, refs/remotes/origin/main` — which the ref
  // grouper (`shared/refGroup.ts`) reads as two unrelated local branches. The
  // short form is the contract, so it is pinned here rather than assumed.
  '--decorate=short',
] as const

// git separates decorations with a comma *and a space*, and a ref name may not
// contain a space (`git check-ref-format` rejects it) — so `", "` can never
// occur inside one entry, which makes it the only exact split. Splitting on the
// bare comma instead tears a legal ref name like the tag `v1,origin/release`
// into `tag: v1` plus a fragment `origin/release`, and a fragment shaped like
// `<remote>/<branch>` is indistinguishable from a real remote-tracking ref: it
// would be folded into an unrelated branch's pill as a remote that agrees with
// it, which is a sync claim manufactured from a tag name.
const DECORATION_SEPARATOR = ', '

/** Split a `%d` decoration like ` (HEAD -> main, origin/main, tag: v1)` into refs. */
export function parseRefDecorations(rawDecoration: string): string[] {
  if (!rawDecoration.trim()) return []
  return rawDecoration
    .replace(/^\s*\(/, '')
    .replace(/\)\s*$/, '')
    .split(DECORATION_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Parse the output of `git log` in {@link COMMIT_LOG_PRETTY_FORMAT} into
 * structured commits. Pure text-in/data-out; malformed lines are skipped
 * quietly so one odd row never takes down the whole graph.
 */
export function parseGitLog(logText: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const line of logText.split('\n')) {
    if (!line.trim()) continue
    const fields = line.split(FIELD_SEPARATOR)
    if (fields.length < 6) continue // not a well-formed row — skip quietly
    const [hash, parentField, decoration, author, date] = fields as [
      string,
      string,
      string,
      string,
      string,
    ]
    const subject = fields.slice(5).join(FIELD_SEPARATOR) // subjects may contain the separator
    commits.push({
      hash: hash.trim(),
      parents: parentField.trim() ? parentField.trim().split(/\s+/) : [],
      refs: parseRefDecorations(decoration),
      author: author.trim(),
      date: date.trim(),
      subject,
    })
  }
  return commits
}
