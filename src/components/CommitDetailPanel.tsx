import type { ReactNode } from 'react'
import {
  IconArrowRight,
  IconBinary,
  IconFileDiff,
  IconFileMinus,
  IconFilePlus,
  IconFileUnknown,
  IconX,
} from '@tabler/icons-react'
import type { CommitDetail, CommitFileChange, FileChangeStatus } from '../../shared/git.schema'
import { CopyButton } from './CopyButton'
import { RefPill, refName } from './RefPill'

// The commit detail surface: one commit in, its metadata, message and changed
// files out. Like CommitGraph it fetches nothing and owns no app chrome — the
// host passes a loaded detail, a loading flag, or an error, so this component
// can be lifted into another host as-is.

const STATUS_ICONS: Record<FileChangeStatus, typeof IconFileDiff> = {
  added: IconFilePlus,
  modified: IconFileDiff,
  deleted: IconFileMinus,
  renamed: IconArrowRight,
  copied: IconArrowRight,
  'type-changed': IconFileDiff,
  unmerged: IconFileUnknown,
  unknown: IconFileUnknown,
}

const STATUS_COLORS: Record<FileChangeStatus, string> = {
  added: 'text-[#7ee787]',
  modified: 'text-[#e3b341]',
  deleted: 'text-[#ff7b72]',
  renamed: 'text-[#d2a8ff]',
  copied: 'text-[#d2a8ff]',
  'type-changed': 'text-[#e3b341]',
  unmerged: 'text-dim',
  unknown: 'text-dim',
}

/** ISO 8601 from git → the local, readable form, with the raw value as a tooltip. */
function formatCommitDate(isoDate: string) {
  if (!isoDate) return { text: '—', title: 'git reported no date' }
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return { text: isoDate, title: isoDate }
  return {
    text: parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    title: isoDate,
  }
}

function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="py-1 text-faint">{label}</dt>
      <dd className="min-w-0 py-1">{children}</dd>
    </>
  )
}

function FileChangeRow({ file }: { file: CommitFileChange }) {
  const StatusIcon = STATUS_ICONS[file.status]
  const description =
    file.previousPath !== null
      ? `${file.status}: ${file.previousPath} → ${file.path}`
      : `${file.status}: ${file.path}`
  return (
    <li className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-rowhover" title={description}>
      <StatusIcon
        size={14}
        className={`shrink-0 ${STATUS_COLORS[file.status]}`}
        aria-label={file.status}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
        {file.previousPath !== null && (
          <span className="text-faint line-through">{file.previousPath} </span>
        )}
        {file.path}
      </span>
      <CopyButton value={file.path} label="file path" />
      {file.binary ? (
        <IconBinary size={13} className="shrink-0 text-faint" aria-label="binary file" />
      ) : (
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          {file.additions !== null && file.additions > 0 && (
            <span className="text-[#7ee787]">+{file.additions}</span>
          )}
          {file.additions !== null &&
            file.additions > 0 &&
            file.deletions !== null &&
            file.deletions > 0 &&
            ' '}
          {file.deletions !== null && file.deletions > 0 && (
            <span className="text-[#ff7b72]">−{file.deletions}</span>
          )}
        </span>
      )}
    </li>
  )
}

export type CommitDetailPanelProps = {
  /** The loaded commit, or null while loading or after a failure. */
  detail: CommitDetail | null
  isLoading: boolean
  error: string | null
  /** Hash the panel was opened for — shown as the heading before the detail arrives. */
  requestedHash: string
  /** Selecting a parent hash navigates the graph to that commit. */
  onSelectCommit: (commitHash: string) => void
  /** Parent hashes that are not among the loaded commits cannot be navigated to. */
  isCommitLoaded: (commitHash: string) => boolean
  onClose: () => void
}

export function CommitDetailPanel({
  detail,
  isLoading,
  error,
  requestedHash,
  onSelectCommit,
  isCommitLoaded,
  onClose,
}: CommitDetailPanelProps) {
  const authored = formatCommitDate(detail?.authorDate ?? '')
  const committed = formatCommitDate(detail?.committerDate ?? '')
  // Only worth showing separately when the commit was not authored and
  // committed by the same person at the same moment (a rebase, an amend, a
  // patch applied by someone else).
  const showCommitter =
    detail !== null &&
    (detail.committer !== detail.author || detail.committerDate !== detail.authorDate)

  const totalAdditions = (detail?.files ?? []).reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const totalDeletions = (detail?.files ?? []).reduce((sum, file) => sum + (file.deletions ?? 0), 0)

  return (
    <aside
      className="flex w-[26rem] shrink-0 flex-col overflow-hidden border-l border-line bg-raised"
      aria-label="Commit details"
    >
      <header className="flex items-start gap-2 border-b border-line px-3 py-2">
        <h2 className="min-w-0 flex-1 text-[13px] leading-snug font-semibold break-words">
          {detail?.subject || (error !== null ? 'Commit unavailable' : 'Loading commit…')}
        </h2>
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded p-0.5 text-faint hover:bg-rowhover hover:text-fg"
          onClick={onClose}
          title="close the details panel (Esc)"
          aria-label="Close the details panel"
        >
          <IconX size={16} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">
        {error !== null && <p className="text-[#ff7b72]">{error}</p>}
        {error === null && detail === null && isLoading && (
          <p className="text-faint">
            Loading <code className="font-mono">{requestedHash}</code>…
          </p>
        )}

        {detail !== null && (
          <>
            {detail.body && (
              <pre className="mb-3 font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-dim">
                {detail.body}
              </pre>
            )}

            <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-2 border-t border-line pt-1.5 text-[12px]">
              <MetadataRow label="commit">
                <span className="inline-flex min-w-0 items-center gap-1">
                  {/* The full 40-character hash is the widest thing in the
                      panel — a notch down in size keeps it on one line with
                      room for the copy control. */}
                  <span className="truncate font-mono text-[11px]" title={detail.fullHash}>
                    {detail.fullHash}
                  </span>
                  <CopyButton value={detail.fullHash} label="commit hash" />
                </span>
              </MetadataRow>

              <MetadataRow label="author">
                <span className="break-words">
                  {detail.author}{' '}
                  <span className="text-faint">&lt;{detail.authorEmail || '—'}&gt;</span>
                </span>
              </MetadataRow>

              <MetadataRow label="authored">
                <span title={authored.title}>{authored.text}</span>
              </MetadataRow>

              {showCommitter && (
                <MetadataRow label="committed">
                  <span title={committed.title}>
                    {committed.text}
                    {detail.committer !== detail.author && (
                      <span className="text-faint"> by {detail.committer}</span>
                    )}
                  </span>
                </MetadataRow>
              )}

              <MetadataRow label={detail.parents.length === 1 ? 'parent' : 'parents'}>
                {detail.parents.length === 0 ? (
                  <span className="text-faint">none — this is a root commit</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {detail.parents.map((parentHash) => {
                      const loaded = isCommitLoaded(parentHash)
                      return (
                        <button
                          key={parentHash}
                          type="button"
                          className="cursor-pointer rounded border border-line px-1.5 py-0.5 font-mono text-[11.5px] text-accent hover:bg-rowhover disabled:cursor-not-allowed disabled:text-faint disabled:opacity-60 disabled:hover:bg-transparent"
                          onClick={() => onSelectCommit(parentHash)}
                          disabled={!loaded}
                          // ADR-0025: still visible when it cannot be followed.
                          title={
                            loaded
                              ? `show ${parentHash}`
                              : `${parentHash} is outside the loaded history — raise the commit limit to follow it`
                          }
                        >
                          {parentHash}
                        </button>
                      )
                    })}
                  </span>
                )}
              </MetadataRow>

              {detail.refs.length > 0 && (
                <MetadataRow label="refs">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {detail.refs.map((refDecoration) => (
                      <span key={refDecoration} className="inline-flex items-center gap-0.5">
                        <RefPill refDecoration={refDecoration} />
                        <CopyButton value={refName(refDecoration)} label="ref name" />
                      </span>
                    ))}
                  </span>
                </MetadataRow>
              )}
            </dl>

            <h3 className="mt-3.5 flex items-baseline gap-2 border-t border-line pt-2.5 text-[12px] text-faint">
              <span>
                {detail.files.length} file{detail.files.length === 1 ? '' : 's'} changed
                {detail.filesTruncated && ' (first 500)'}
              </span>
              <span className="ml-auto font-mono text-[11px] tabular-nums">
                {totalAdditions > 0 && <span className="text-[#7ee787]">+{totalAdditions}</span>}
                {totalAdditions > 0 && totalDeletions > 0 && ' '}
                {totalDeletions > 0 && <span className="text-[#ff7b72]">−{totalDeletions}</span>}
              </span>
            </h3>

            {detail.files.length === 0 ? (
              <p className="py-1.5 text-faint">
                {detail.parents.length > 1
                  ? 'This merge brought in no changes of its own.'
                  : 'This commit changed no files.'}
              </p>
            ) : (
              <ul className="mt-1 -ml-2">
                {detail.files.map((file) => (
                  <FileChangeRow key={`${file.previousPath ?? ''}${file.path}`} file={file} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
