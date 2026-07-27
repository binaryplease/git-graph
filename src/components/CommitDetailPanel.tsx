import type { MouseEvent, ReactNode } from 'react'
import { IconBinary, IconChevronDown, IconChevronRight, IconExternalLink, IconGitCompare, IconX } from '@tabler/icons-react'
import type { CommitDetail, CommitFileChange, FileDiff as FileDiffPayload } from '../../shared/git.schema'
import { CopyButton } from './CopyButton'
import { FileDiff } from './FileDiff'
import {
  FileLineStats,
  FileStatusIcon,
  OpenFileButton,
  describeFileChange,
  type OpenFileHandler,
} from './fileStatus'
import { RefPill, classifyRef, refName } from './RefPill'

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
  /** The @git-diff-view colour scheme for the inline diff body, threaded from the panel. */
  diffViewTheme: 'light' | 'dark'
  /** The host's open-file seam; when set, the row shows a distinct open-file control. */
  onOpenFile?: OpenFileHandler
  /**
   * The host's open-this-file's-diff seam (ADR-0026). When set it takes
   * precedence over {@link diffHref}: the external-link control becomes a real
   * enabled button that invokes it, and cmd/ctrl/middle-click routes here too —
   * the host owns the destination (e.g. an in-app modal), so there is no
   * "new tab". Absent, the row keeps its href-or-disabled behaviour.
   */
  onOpenFileDiff?: () => void
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
  diffViewTheme,
  onOpenFile,
  onOpenFileDiff,
}: FileChangeRowProps) {
  const description = describeFileChange(file)
  const ChevronIcon = isExpanded ? IconChevronDown : IconChevronRight
  const diffBodyId = `file-diff-${file.path.replace(/[^\w-]/g, '_')}`

  // A modified/ctrl/cmd/middle-click opens the diff away from the inline
  // disclosure; a plain click keeps it. Precedence matches the visible control:
  // the host's open-diff seam first, else the new-tab href, else a plain toggle.
  function handleToggleClick(clickEvent: MouseEvent<HTMLButtonElement>) {
    if (clickEvent.metaKey || clickEvent.ctrlKey) {
      if (onOpenFileDiff) {
        onOpenFileDiff()
        return
      }
      if (diffHref !== null) {
        window.open(diffHref, '_blank', 'noopener,noreferrer')
        return
      }
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
          <FileStatusIcon status={file.status} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
            {file.previousPath !== null && (
              <span className="text-faint line-through">{file.previousPath} </span>
            )}
            {file.path}
          </span>
        </button>
        {/* ADR-0025: a real, keyboard-reachable control for opening the diff —
            not only the mouse-only modifier gesture — sitting beside the file it
            opens (ADR-0031). Precedence: the host's open-diff seam (an enabled
            button, host-owned destination) > the new-tab href > disabled when
            there is nothing to open. */}
        {onOpenFileDiff ? (
          <button
            type="button"
            className="inline-flex shrink-0 cursor-pointer items-center rounded p-0.5 text-faint transition-colors hover:bg-rowhover hover:text-fg"
            onClick={onOpenFileDiff}
            title={`open ${file.path} diff`}
            aria-label={`open ${file.path} diff`}
          >
            <IconExternalLink size={14} aria-hidden />
          </button>
        ) : diffHref !== null ? (
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
        {/* The host's open-file seam (ADR-0031: on the row it opens), distinct
            from the inline-diff toggle and the open-in-new-tab link above. */}
        {onOpenFile && <OpenFileButton file={file} onOpenFile={onOpenFile} />}
        <CopyButton value={file.path} label="file path" />
        {file.binary ? (
          <IconBinary size={13} className="shrink-0 text-faint" aria-label="binary file" />
        ) : (
          <FileLineStats additions={file.additions} deletions={file.deletions} />
        )}
      </div>

      {isExpanded && (
        <div id={diffBodyId} className="mt-1 mb-2 ml-1">
          <FileDiff diff={diff} isLoading={isLoadingDiff} error={diffError} diffViewTheme={diffViewTheme} />
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
  /** URL of the full-commit tab (metadata + every file's diff), or null with no commit context. */
  buildCommitDiffHref: () => string | null
  /**
   * URL comparing a branch against the default base, or null for refs that are
   * not comparable (tags, or the default branch itself). The host owns the route
   * scheme; the panel only turns branch names into links.
   */
  buildCompareHref: (branchName: string) => string | null
  /** The diff for {@link expandedFilePath}; the host owns the fetching. */
  fileDiff: FileDiffPayload | null
  isLoadingFileDiff: boolean
  fileDiffError: string | null
  onClose: () => void
  /**
   * The @git-diff-view colour scheme. Defaults to `dark` — the standalone app's
   * single GitHub-dark palette — so this repo's own callers are unchanged. An
   * embedding host (nightshift-ui) with a live light/dark theme passes its
   * resolved scheme so the inline diff bodies flip with the host rather than
   * staying dark.
   */
  diffViewTheme?: 'light' | 'dark'
  /**
   * Optional host seam (ADR-0026): when provided, each changed-file row shows a
   * distinct "open this file" control that invokes it with the file — for a host
   * that opens the file in its own surface (e.g. an in-app file browser). It never
   * hijacks the row's inline-diff disclosure or its open-in-new-tab link; omit it
   * and the control is absent, exactly as the standalone app renders today.
   */
  onOpenFile?: OpenFileHandler
  /**
   * Optional host seam (ADR-0026): open one file's diff in the host's own surface
   * (e.g. an in-app modal) instead of a new tab. When set it takes precedence over
   * {@link buildFileDiffHref} — the per-file external-link control becomes an
   * enabled button and cmd/ctrl/middle-click routes here. Binary files pass no
   * handler (nothing to diff), so their control stays disabled-and-explained.
   * Omit it and the row keeps today's href-or-disabled behaviour.
   */
  onOpenFileDiff?: (filePath: string) => void
  /**
   * Optional host seam (ADR-0026): open the whole commit's diff in the host's own
   * surface. When set it takes precedence over {@link buildCommitDiffHref} — the
   * files-changed heading control becomes an enabled button. Omit it and the
   * heading keeps today's href-or-absent behaviour.
   */
  onOpenCommitDiff?: () => void
  /**
   * Optional host seam (ADR-0026): compare a branch against the default base in the
   * host's own surface. When set it takes precedence over {@link buildCompareHref}
   * — each local-branch ref pill's compare control becomes an enabled button that
   * invokes it with the branch name. Omit it and the pill keeps today's
   * href-or-absent behaviour.
   */
  onOpenCompare?: (branchName: string) => void
  /**
   * Where this panel is mounted, which drives its frame — not its content. The
   * body (message, metadata, changed files) is identical either way (ADR-0027:
   * the invariant is the detail, not the container). `sidebar` (the default) is
   * the docked right rail that widens for an open diff; `inline` is a full-width
   * block the graph shell renders in-flow beneath the selected commit row.
   */
  variant?: 'sidebar' | 'inline'
  /**
   * Optional host seam: extra controls rendered in the panel's control cluster,
   * before the close button (sidebar: in the titled header; inline: the floating
   * top-right corner). A host that wants a per-panel action can pass it here; the
   * standalone app keeps its layout toggle in the app-wide top bar instead, so it
   * passes nothing and the cluster is just the close button.
   */
  headerActions?: ReactNode
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
  buildCommitDiffHref,
  buildCompareHref,
  fileDiff,
  isLoadingFileDiff,
  fileDiffError,
  onClose,
  diffViewTheme = 'dark',
  onOpenFile,
  onOpenFileDiff,
  onOpenCommitDiff,
  onOpenCompare,
  variant = 'sidebar',
  headerActions,
}: CommitDetailPanelProps) {
  const isInline = variant === 'inline'
  const commitDiffHref = buildCommitDiffHref()
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

  // The panel's view controls (any host-supplied headerActions + close). Sidebar
  // hangs them off its titled header; inline has no title to head a bar, so it
  // floats the same cluster compactly in the top-right corner instead (below).
  const panelControls = (
    <>
      {headerActions}
      <button
        type="button"
        className="shrink-0 cursor-pointer rounded p-0.5 text-faint hover:bg-rowhover hover:text-fg"
        onClick={onClose}
        title="close the details panel (Esc)"
        aria-label="Close the details panel"
      >
        <IconX size={16} aria-hidden />
      </button>
    </>
  )

  const Container = isInline ? 'section' : 'aside'
  return (
    <Container
      // Sidebar: metadata reads fine at 26rem, wrapped code does not, so the rail
      // widens for the file that is open and gives the width back when it closes —
      // capped, because a narrow window would otherwise leave the graph too thin
      // to show a commit subject. Inline: a full-width block in the row flow, its
      // height capped so a large commit scrolls in place rather than pushing the
      // rows below off-screen. Positioned so the inline controls anchor to it.
      className={
        isInline
          ? 'relative flex max-h-[65vh] flex-col overflow-hidden border-y border-line bg-raised'
          : `flex shrink-0 flex-col overflow-hidden border-l border-line bg-raised transition-[width] duration-150 ${
              expandedFilePath !== null ? 'w-[44rem] max-w-[55vw]' : 'w-[26rem]'
            }`
      }
      aria-label="Commit details"
    >
      {/* Inline sits directly beneath its commit row, which already shows the
          subject — repeating it in a header would duplicate it (ADR-0027: the row
          owns the title there). A full-width header bar with only a corner control
          would strand an empty band across the block, so inline drops the header
          entirely and floats just the close control in the top-right corner; the
          body then starts at the very top with no reserved whitespace. Its
          bg-raised backing masks the rare metadata line or scrolled row that would
          pass beneath it. The sidebar is detached from the row, so it keeps a
          titled header carrying the same controls. */}
      {isInline ? (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-raised pl-3">
          {panelControls}
        </div>
      ) : (
        <header className="flex items-start gap-2 border-b border-line px-3 py-2">
          <h2 className="min-w-0 flex-1 text-[13px] leading-snug font-semibold break-words">
            {detail?.subject || (error !== null ? 'Commit unavailable' : 'Loading commit…')}
          </h2>
          {panelControls}
        </header>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-3 pt-2 pb-2.5">
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

            {/* The rule above the metadata only earns its place as a separator
                from the free-text message above it — with no body it sits right
                under the header and reads as a redundant line, so drop it then. */}
            <dl
              className={`grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-2 text-[12px] ${
                detail.body ? 'border-t border-line pt-1.5' : ''
              }`}
            >
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
                    {detail.refs.map((refDecoration) => {
                      // Only a local branch can be compared against the default
                      // base — a remote-tracking ref or a tag is not one the
                      // server's branch listing validates.
                      const branchName = refName(refDecoration)
                      const refKind = classifyRef(refDecoration)
                      // Only a local branch is comparable; a tag or remote-tracking
                      // ref is not one the server's branch listing validates.
                      const isComparableRef = refKind === 'branch' || refKind === 'head'
                      const compareTo = isComparableRef ? buildCompareHref(branchName) : null
                      return (
                        <span key={refDecoration} className="inline-flex items-center gap-0.5">
                          <RefPill refDecoration={refDecoration} />
                          <CopyButton value={branchName} label="ref name" />
                          {/* ADR-0031: the compare affordance sits on the branch
                              pill it acts on, not in global chrome. Precedence: the
                              host's compare seam (an enabled button, host-owned
                              destination) > the new-tab href > nothing. */}
                          {onOpenCompare && isComparableRef ? (
                            <button
                              type="button"
                              className="inline-flex shrink-0 cursor-pointer items-center rounded p-0.5 text-faint transition-colors hover:bg-rowhover hover:text-fg"
                              onClick={() => onOpenCompare(branchName)}
                              title={`compare ${branchName} against the default branch`}
                              aria-label={`compare ${branchName} against the default branch`}
                            >
                              <IconGitCompare size={13} aria-hidden />
                            </button>
                          ) : compareTo !== null ? (
                            <a
                              href={compareTo}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex shrink-0 cursor-pointer items-center rounded p-0.5 text-faint transition-colors hover:bg-rowhover hover:text-fg"
                              title={`compare ${branchName} against the default branch in a new tab`}
                              aria-label={`compare ${branchName} against the default branch in a new tab`}
                            >
                              <IconGitCompare size={13} aria-hidden />
                            </a>
                          ) : null}
                        </span>
                      )
                    })}
                  </span>
                </MetadataRow>
              )}
            </dl>

            <h3 className="mt-3.5 flex items-baseline gap-2 border-t border-line pt-2.5 text-[12px] text-faint">
              <span>
                {detail.files.length} file{detail.files.length === 1 ? '' : 's'} changed
                {detail.filesTruncated && ' (first 500)'}
              </span>
              {/* ADR-0031: opening the whole commit's diff belongs beside the
                  file list it opens, not in remote chrome. Precedence: the host's
                  open-commit-diff seam (an enabled button) > the new-tab href. */}
              {detail.files.length > 0 &&
                (onOpenCommitDiff ? (
                  <button
                    type="button"
                    className="inline-flex shrink-0 cursor-pointer items-center self-center rounded p-0.5 text-faint transition-colors hover:bg-rowhover hover:text-fg"
                    onClick={onOpenCommitDiff}
                    title="open this commit's full diff"
                    aria-label="open this commit's full diff"
                  >
                    <IconExternalLink size={13} aria-hidden />
                  </button>
                ) : commitDiffHref !== null ? (
                  <a
                    href={commitDiffHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 cursor-pointer items-center self-center rounded p-0.5 text-faint transition-colors hover:bg-rowhover hover:text-fg"
                    title="open this commit's full diff in a new tab"
                    aria-label="open this commit's full diff in a new tab"
                  >
                    <IconExternalLink size={13} aria-hidden />
                  </a>
                ) : null)}
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
                      // Gated for binary exactly as diffHref is — a binary row
                      // keeps its disabled-and-explained control (ADR-0025).
                      onOpenFileDiff={
                        file.binary || !onOpenFileDiff ? undefined : () => onOpenFileDiff(file.path)
                      }
                      diff={isExpanded ? fileDiff : null}
                      isLoadingDiff={isExpanded && isLoadingFileDiff}
                      diffError={isExpanded ? fileDiffError : null}
                      diffViewTheme={diffViewTheme}
                      onOpenFile={onOpenFile}
                    />
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </Container>
  )
}
