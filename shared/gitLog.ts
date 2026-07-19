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
] as const

/** Split a `%d` decoration like ` (HEAD -> main, origin/main, tag: v1)` into refs. */
export function parseRefDecorations(rawDecoration: string): string[] {
  if (!rawDecoration.trim()) return []
  return rawDecoration
    .replace(/^\s*\(/, '')
    .replace(/\)\s*$/, '')
    .split(',')
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
