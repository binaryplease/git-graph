import type { CommitFileChange, FileChangeStatus } from './git.schema'
import { FIELD_SEPARATOR, parseRefDecorations } from './gitLog'

// The `git show` wire format for a single commit's detail, and its parser.
// Sibling of `gitLog.ts`: same unit-separator discipline, same pure
// text-in/data-out contract, no process spawning here.
//
// One `git show` call yields both halves of the payload:
//   header  — the `--format` fields, terminated by the record separator (0x1e)
//   files   — `--raw` lines (status + paths) followed by `--numstat` lines
//             (added/deleted counts), listing the same entries in the same
//             order, which is what lets them be zipped positionally.
export const RECORD_SEPARATOR = '\x1e'

// %H full hash · %h abbreviated · %p abbreviated parents · %D refs ·
// %an/%ae/%aI author · %cn/%ce/%cI committer · %s subject · %b body.
// The body is multi-line, so it must be the last field and needs the record
// separator to mark where the header ends and the file block begins.
export const COMMIT_DETAIL_PRETTY_FORMAT =
  ['%H', '%h', '%p', '%D', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%s', '%b'].join('%x1f') +
  '%x1e'

export const COMMIT_DETAIL_ARGUMENTS = [
  'show',
  '--no-color',
  '--raw',
  '--numstat',
  // For a merge, show the diff against the first parent only — otherwise git
  // prints nothing at all for merges. A no-op on ordinary commits.
  '-m',
  '--first-parent',
  `--format=${COMMIT_DETAIL_PRETTY_FORMAT}`,
] as const

/** Commits touching more files than this report a truncated file list. */
export const MAX_FILE_CHANGES = 500

const RAW_STATUS_LETTERS: Record<string, FileChangeStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'unmerged',
}

/**
 * Parse one `--raw` line such as
 * `:100644 100644 814f4a4 de7b749 R061\ta.txt\trenamed.txt`.
 * Renames and copies carry two paths — source first, destination second.
 */
function parseRawLine(line: string): { status: FileChangeStatus; path: string; previousPath: string | null } | null {
  const [metadata, ...paths] = line.slice(1).split('\t')
  const destinationPath = paths[paths.length - 1]
  if (!metadata || !destinationPath) return null
  // The status is the last space-separated field; rename/copy append a
  // similarity score (`R061`) that is not part of the status itself.
  const statusField = metadata.trim().split(/\s+/).pop() ?? ''
  const status = RAW_STATUS_LETTERS[statusField.charAt(0).toUpperCase()] ?? 'unknown'
  const isRenameOrCopy = paths.length > 1
  return {
    status,
    path: destinationPath,
    previousPath: isRenameOrCopy ? (paths[0] ?? null) : null,
  }
}

/** Parse one `--numstat` line: `1\t0\ta.txt`, or `-\t-\tblob.bin` for binaries. */
function parseNumstatLine(line: string): { additions: number | null; deletions: number | null } | null {
  const [addedField, deletedField] = line.split('\t')
  if (addedField === undefined || deletedField === undefined) return null
  const toCount = (field: string) => (field === '-' ? null : Number.parseInt(field, 10))
  const additions = toCount(addedField)
  const deletions = toCount(deletedField)
  if (additions !== null && Number.isNaN(additions)) return null
  if (deletions !== null && Number.isNaN(deletions)) return null
  return { additions, deletions }
}

/**
 * Parse the file block that follows the header — the `--raw` lines zipped with
 * the `--numstat` lines. Both listings describe the same diff queue in the same
 * order; a numstat row missing its raw partner still yields a change entry with
 * an `unknown` status rather than being dropped.
 */
export function parseCommitFileChanges(fileBlock: string): {
  files: CommitFileChange[]
  truncated: boolean
} {
  const rawEntries: ReturnType<typeof parseRawLine>[] = []
  const numstatEntries: ReturnType<typeof parseNumstatLine>[] = []
  for (const line of fileBlock.split('\n')) {
    if (!line.trim()) continue
    if (line.startsWith(':')) {
      const rawEntry = parseRawLine(line)
      if (rawEntry) rawEntries.push(rawEntry)
      continue
    }
    const numstatEntry = parseNumstatLine(line)
    if (numstatEntry) numstatEntries.push(numstatEntry)
  }

  const entryCount = Math.max(rawEntries.length, numstatEntries.length)
  const files: CommitFileChange[] = []
  for (let entryIndex = 0; entryIndex < Math.min(entryCount, MAX_FILE_CHANGES); entryIndex += 1) {
    const rawEntry = rawEntries[entryIndex]
    const numstatEntry = numstatEntries[entryIndex]
    const path = rawEntry?.path ?? null
    if (path === null) continue
    const additions = numstatEntry?.additions ?? null
    const deletions = numstatEntry?.deletions ?? null
    files.push({
      path,
      previousPath: rawEntry?.previousPath ?? null,
      status: rawEntry?.status ?? 'unknown',
      additions,
      deletions,
      // Git reports `-` counts exactly for the files it cannot diff by line.
      binary: numstatEntry !== undefined && additions === null && deletions === null,
    })
  }
  return { files, truncated: entryCount > MAX_FILE_CHANGES }
}

export type ParsedCommitDetail = {
  fullHash: string
  hash: string
  parents: string[]
  refs: string[]
  author: string
  authorEmail: string
  authorDate: string
  committer: string
  committerEmail: string
  committerDate: string
  subject: string
  body: string
  files: CommitFileChange[]
  filesTruncated: boolean
}

/**
 * Parse the output of {@link COMMIT_DETAIL_ARGUMENTS} into a structured commit
 * detail. Returns null when the header is not well formed, so a surprising
 * payload surfaces as a boundary failure instead of a half-filled record.
 */
export function parseCommitDetail(showOutput: string): ParsedCommitDetail | null {
  const separatorIndex = showOutput.indexOf(RECORD_SEPARATOR)
  if (separatorIndex < 0) return null
  const header = showOutput.slice(0, separatorIndex)
  const fileBlock = showOutput.slice(separatorIndex + RECORD_SEPARATOR.length)

  const fields = header.split(FIELD_SEPARATOR)
  if (fields.length < 12) return null
  const [
    fullHash,
    hash,
    parentField,
    decoration,
    author,
    authorEmail,
    authorDate,
    committer,
    committerEmail,
    committerDate,
    subject,
  ] = fields as string[]
  if (!fullHash?.trim() || !hash?.trim()) return null
  // The body may itself contain the separator; it is the tail join, exactly as
  // the subject is in `parseGitLog`.
  const body = fields.slice(11).join(FIELD_SEPARATOR)

  const { files, truncated } = parseCommitFileChanges(fileBlock)
  return {
    fullHash: fullHash.trim(),
    hash: hash.trim(),
    parents: parentField?.trim() ? parentField.trim().split(/\s+/) : [],
    refs: parseRefDecorations(decoration ?? ''),
    author: (author ?? '').trim(),
    authorEmail: (authorEmail ?? '').trim(),
    authorDate: (authorDate ?? '').trim(),
    committer: (committer ?? '').trim(),
    committerEmail: (committerEmail ?? '').trim(),
    committerDate: (committerDate ?? '').trim(),
    subject: subject ?? '',
    body: body.replace(/\n+$/, ''),
    files,
    filesTruncated: truncated,
  }
}
