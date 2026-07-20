import {
  IconArrowRight,
  IconFileDiff,
  IconFileMinus,
  IconFilePlus,
  IconFileUnknown,
} from '@tabler/icons-react'
import type { CommitFileChange, FileChangeStatus } from '../../shared/git.schema'

// The one description of how a changed file looks — its status icon, its status
// colour, and its added/removed line counts. Shared (ADR-0026/ADR-0028) by every
// surface that lists changed files: the docked commit panel and the full-tab
// commit and compare views, rather than a copy re-declared on each.

export const FILE_STATUS_ICONS: Record<FileChangeStatus, typeof IconFileDiff> = {
  added: IconFilePlus,
  modified: IconFileDiff,
  deleted: IconFileMinus,
  renamed: IconArrowRight,
  copied: IconArrowRight,
  'type-changed': IconFileDiff,
  unmerged: IconFileUnknown,
  unknown: IconFileUnknown,
}

export const FILE_STATUS_COLORS: Record<FileChangeStatus, string> = {
  added: 'text-[#7ee787]',
  modified: 'text-[#e3b341]',
  deleted: 'text-[#ff7b72]',
  renamed: 'text-[#d2a8ff]',
  copied: 'text-[#d2a8ff]',
  'type-changed': 'text-[#e3b341]',
  unmerged: 'text-dim',
  unknown: 'text-dim',
}

/** The status glyph for a changed file, coloured by kind and labelled for AT. */
export function FileStatusIcon({ status, size = 14 }: { status: FileChangeStatus; size?: number }) {
  const Icon = FILE_STATUS_ICONS[status]
  return <Icon size={size} className={`shrink-0 ${FILE_STATUS_COLORS[status]}`} aria-label={status} />
}

/** A one-line description of a change, e.g. `renamed: old.ts → new.ts`. */
export function describeFileChange(file: CommitFileChange): string {
  return file.previousPath !== null
    ? `${file.status}: ${file.previousPath} → ${file.path}`
    : `${file.status}: ${file.path}`
}

/** The `+N −M` line counts of a change; renders nothing when both are zero or null. */
export function FileLineStats({
  additions,
  deletions,
}: {
  additions: number | null
  deletions: number | null
}) {
  const hasAdditions = additions !== null && additions > 0
  const hasDeletions = deletions !== null && deletions > 0
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      {hasAdditions && <span className="text-[#7ee787]">+{additions}</span>}
      {hasAdditions && hasDeletions && ' '}
      {hasDeletions && <span className="text-[#ff7b72]">−{deletions}</span>}
    </span>
  )
}
