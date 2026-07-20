import type { MouseEvent, ReactNode } from 'react'
import {
  IconArrowRight,
  IconBinary,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconFileDiff,
  IconFileMinus,
  IconFilePlus,
  IconFileUnknown,
  IconX,
} from '@tabler/icons-react'
import type {
  CommitDetail,
  CommitFileChange,
  FileChangeStatus,
  FileDiff as FileDiffPayload,
} from '../../shared/git.schema'
import { CopyButton } from './CopyButton'
import { FileDiff } from './FileDiff'
import { RefPill, refName } from './RefPill'

// The commit detail surface: one commit in, its metadata, message and changed
// files out. Like CommitGraph it fetches nothing and owns no app chrome — the
// host passes a loaded detail, a loading flag, or an error, so this component
// can be lifted into another host as-is.

// The new-tab modifier is Cmd on Apple platforms, Ctrl elsewhere — name the one
// the user actually presses in the tooltip rather than listing both.
const MODIFIER_HINT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? 'Cmd'
    : 'Ctrl'

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

type FileChangeRowProps = {
  file: CommitFileChange
  isExpanded: boolean
  onToggle: () => void
  /**
   * The standalone diff-tab URL for this file, or null when the host cannot
   * build one (no commit context) or the file has no diff to open (binary).
   */
  diffHref: string | null
  /** The diff for this file — only ever non-null while this row is the expanded one. */
  diff: FileDiffPayload | null
  isLoadingDiff: boolean
  diffError: string | null
}

/**
 * One changed file, and its diff as a disclosure. ADR-0031: the affordances that
 * open a file's diff sit on that file's row, not in the panel header. A plain
 * click discloses the diff inline; cmd/ctrl/middle-click — and the adjacent
 * external-link control — open it in a new tab, the way VS Code's Git Graph
 * opens a file diff in its own editor tab.
 */
function FileChangeRow({
  file,
  isExpanded,
  onToggle,
  diffHref,
  diff,
  isLoadingDiff,
  diffError,
}: FileChangeRowProps) {
  const StatusIcon = STATUS_ICONS[file.status]
  const description =
    file.previousPath !== null
      ? `${file.status}: ${file.previousPath} → ${file.path}`
      : `${file.status}: ${file.path}`
  const ChevronIcon = isExpanded ? IconChevronDown : IconChevronRight
  const diffBodyId = `file-diff-${file.path.replace(/[^\w-]/g, '_')}`

  // A modified/ctrl/cmd/middle-click opens the diff in a new tab instead of
  // toggling it inline; a plain click keeps the inline disclosure.
  function handleToggleClick(clickEvent: MouseEvent<HTMLButtonElement>) {
    if (diffHref !== null && (clickEvent.metaKey || clickEvent.ctrlKey)) {
      window.open(diffHref, '_blank', 'noopener,noreferrer')
      return
    }
    onToggle()
  }

  return (
    <li className="rounded">
      <div className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-rowhover">
        {/* The copy control is a button of its own, so the toggle can only own
            the path itself — buttons do not nest. */}
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded text-left disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleToggleClick}
          disabled={file.binary}
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? diffBodyId : undefined}
          // ADR-0025: a binary row keeps its toggle, visible and explained.
          title={
            file.binary
              ? `${description} — binary, git reports no line-by-line diff to show`
              : `${description} — click to ${isExpanded ? 'hide' : 'show'} the diff, ${MODIFIER_HINT}-click to open it in a new tab`
          }
        >
          <ChevronIcon size={13} className="shrink-0 text-faint" aria-hidden />
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
        </button>
        {/* ADR-0025: a real, keyboard-reachable control for the new-tab action —
            not only the mouse-only modifier gesture — sitting beside the file it
            opens (ADR-0031). Disabled, not hidden, when there is no diff to open. */}
        {diffHref !== null ? (
          <a
            href={diffHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 cursor-pointer items-center rounded p-0.5 text-faint transition-colors hover:bg-rowhover hover:text-fg"
            title={`open ${file.path} diff in a new tab`}
            aria-label={`open ${file.path} diff in a new tab`}
          >
            <IconExternalLink size={14} aria-hidden />
          </a>
        ) : (
          <span
            className="inline-flex shrink-0 items-center rounded p-0.5 text-faint opacity-45"
            title={
              file.binary
                ? `${file.path} is binary — git reports no line-by-line diff to open`
                : `${file.path} diff cannot be opened in a new tab here`
            }
            aria-label={
              file.binary
                ? `${file.path} is binary, no diff to open in a new tab`
                : `${file.path} diff cannot be opened in a new tab`
            }
            role="img"
          >
            <IconExternalLink size={14} aria-hidden />
          </span>
        )}
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
      </div>

      {isExpanded && (
        <div id={diffBodyId} className="mt-1 mb-2 ml-1">
          <FileDiff diff={diff} isLoading={isLoadingDiff} error={diffError} />
        </div>
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
  /**
   * Path of the file whose diff is open, or null. One at a time: the panel is
   * narrow, and building a diff costs real time, so opening a second file
   * closes the first rather than stacking work nobody is looking at.
   */
  expandedFilePath: string | null
  onToggleFile: (filePath: string) => void
  /**
   * The standalone diff-tab URL for a file of this commit, or null when the host
   * has no commit context to build one. The host owns the route scheme; the
   * panel only turns the string into links (ADR-0031: the affordance sits on the
   * row it opens).
   */
  buildFileDiffHref: (filePath: string) => string | null
  /** The diff for {@link expandedFilePath}; the host owns the fetching. */
  fileDiff: FileDiffPayload | null
  isLoadingFileDiff: boolean
  fileDiffError: string | null
  onClose: () => void
}

export function CommitDetailPanel({
  detail,
  isLoading,
  error,
  requestedHash,
  onSelectCommit,
  isCommitLoaded,
  expandedFilePath,
  onToggleFile,
  buildFileDiffHref,
  fileDiff,
  isLoadingFileDiff,
  fileDiffError,
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
      // Metadata reads fine at 26rem, wrapped code does not. The panel widens
      // for the file that is open and gives the width back when it closes —
      // capped, because a narrow window would otherwise leave the graph too
      // thin to show a commit subject.
      className={`flex shrink-0 flex-col overflow-hidden border-l border-line bg-raised transition-[width] duration-150 ${
        expandedFilePath !== null ? 'w-[44rem] max-w-[55vw]' : 'w-[26rem]'
      }`}
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
              <ul className="mt-1 -ml-1">
                {detail.files.map((file) => {
                  const isExpanded = expandedFilePath === file.path
                  return (
                    <FileChangeRow
                      key={`${file.previousPath ?? ''}${file.path}`}
                      file={file}
                      isExpanded={isExpanded}
                      onToggle={() => onToggleFile(file.path)}
                      // Binary files have no line-by-line diff to open.
                      diffHref={file.binary ? null : buildFileDiffHref(file.path)}
                      diff={isExpanded ? fileDiff : null}
                      isLoadingDiff={isExpanded && isLoadingFileDiff}
                      diffError={isExpanded ? fileDiffError : null}
                    />
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
