import { useCallback, useEffect, useRef, useState } from 'react'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type { CommitFileChange, FileDiff as FileDiffPayload } from '../../shared/git.schema'
import { FileDiff } from './FileDiff'
import {
  FileLineStats,
  FileStatusIcon,
  OpenFileButton,
  describeFileChange,
  type OpenFileHandler,
} from './fileStatus'

// A whole change set — a commit, or a branch comparison — rendered as a file
// list on top and every file's diff stacked below. Like the other diff
// components it fetches nothing itself: the host passes a `loadFileDiff` for one
// file, and this view calls it lazily, one section at a time, as each scrolls
// into view. That keeps a 200-file branch diff from fetching and tokenising 200
// whole files before anything is on screen.

const anchorId = (index: number) => `file-${index}`

type LazyFileDiffSectionProps = {
  file: CommitFileChange
  index: number
  loadFileDiff: (file: CommitFileChange) => Promise<FileDiffPayload>
  mode: 'unified' | 'split'
  diffViewTheme: 'light' | 'dark'
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; diff: FileDiffPayload }
  | { status: 'error'; message: string }

/** One file's diff, loaded the moment its section nears the viewport. */
function LazyFileDiffSection({ file, index, loadFileDiff, mode, diffViewTheme }: LazyFileDiffSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [load, setLoad] = useState<LoadState>({ status: 'idle' })
  const containerRef = useRef<HTMLDivElement>(null)
  const hasRequested = useRef(false)

  const startLoad = useCallback(() => {
    if (hasRequested.current || file.binary) return
    hasRequested.current = true
    setLoad({ status: 'loading' })
    loadFileDiff(file)
      .then((diff) => setLoad({ status: 'ready', diff }))
      .catch((loadError: Error) => setLoad({ status: 'error', message: loadError.message }))
  }, [file, loadFileDiff])

  useEffect(() => {
    if (file.binary) return
    const node = containerRef.current
    // No observer (older browsers, the test DOM): load straight away rather than
    // leaving the section forever pending.
    if (node === null || typeof IntersectionObserver === 'undefined') {
      startLoad()
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          startLoad()
          observer.disconnect()
        }
      },
      // Start fetching a little before the section is actually visible so the
      // diff is usually built by the time it scrolls in.
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [file.binary, startLoad])

  const ChevronIcon = isCollapsed ? IconChevronRight : IconChevronDown
  const bodyId = `${anchorId(index)}-body`

  return (
    <section ref={containerRef} id={anchorId(index)} className="scroll-mt-2 overflow-hidden rounded border border-line">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 bg-raised px-2.5 py-1.5 text-left hover:bg-rowhover"
        onClick={() => setIsCollapsed((collapsed) => !collapsed)}
        aria-expanded={!isCollapsed}
        aria-controls={bodyId}
        title={`${describeFileChange(file)} — click to ${isCollapsed ? 'show' : 'hide'} this diff`}
      >
        <ChevronIcon size={14} className="shrink-0 text-faint" aria-hidden />
        <FileStatusIcon status={file.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
          {file.previousPath !== null && (
            <span className="text-faint line-through">{file.previousPath} </span>
          )}
          {file.path}
        </span>
        <FileLineStats additions={file.additions} deletions={file.deletions} />
      </button>

      {!isCollapsed && (
        <div id={bodyId} className="bg-canvas">
          {file.binary ? (
            <p className="px-2.5 py-2 text-[11.5px] text-faint">
              Binary file — git reports no line-by-line diff.
            </p>
          ) : (
            <FileDiff
              diff={load.status === 'ready' ? load.diff : null}
              isLoading={load.status === 'idle' || load.status === 'loading'}
              error={load.status === 'error' ? load.message : null}
              mode={mode}
              wrap={false}
              fontSize={12.5}
              diffViewTheme={diffViewTheme}
            />
          )}
        </div>
      )}
    </section>
  )
}

export type MultiFileDiffViewProps = {
  files: CommitFileChange[]
  filesTruncated: boolean
  /** How the host fetches one file's diff — the view calls it lazily per section. */
  loadFileDiff: (file: CommitFileChange) => Promise<FileDiffPayload>
  /** Shown in the file-list heading, e.g. `12 files changed`. */
  emptyMessage: string
  /**
   * Per-file diff layout, threaded to every {@link FileDiff}. Defaults to the
   * standalone whole-tab view's `split`; a docked/narrow host can pass `unified`.
   */
  mode?: 'unified' | 'split'
  /**
   * The @git-diff-view colour scheme, threaded to every {@link FileDiff}.
   * Defaults to `dark` (the standalone app's palette) so this repo's callers are
   * unchanged; an embedding host with a live theme passes its resolved scheme.
   */
  diffViewTheme?: 'light' | 'dark'
  /**
   * Optional host seam (ADR-0026): when provided, each file-list row shows a
   * distinct "open this file" control that invokes it with the file — for a host
   * that opens the changed file in its own surface (e.g. an in-app file browser).
   * It never hijacks the file-name jump link or a section's collapse toggle; omit
   * it and the control is absent, exactly as the standalone app renders today.
   */
  onOpenFile?: OpenFileHandler
  /**
   * Optional host seam (ADR-0026): the path of a file to reveal on open. When it
   * changes to a path present in {@link files}, that file's section is scrolled
   * into view — for a host that opens the whole change set focused on one file.
   * It does not disturb the lazy per-section loading (a section still fetches as
   * it nears the viewport). Absent or unmatched, nothing scrolls.
   */
  focusFilePath?: string | null
}

export function MultiFileDiffView({
  files,
  filesTruncated,
  loadFileDiff,
  emptyMessage,
  mode = 'split',
  diffViewTheme = 'dark',
  onOpenFile,
  focusFilePath,
}: MultiFileDiffViewProps) {
  const totalAdditions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const totalDeletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)

  // Reveal the host-requested file when it changes. A plain scrollIntoView on the
  // resolved section id — the sections keep their own lazy IntersectionObserver
  // loading, so bringing one into view just triggers its normal fetch.
  useEffect(() => {
    if (focusFilePath === undefined || focusFilePath === null) return
    const focusIndex = files.findIndex((file) => file.path === focusFilePath)
    if (focusIndex === -1) return
    document.getElementById(anchorId(focusIndex))?.scrollIntoView()
  }, [focusFilePath, files])

  if (files.length === 0) return <p className="px-1 py-6 text-faint">{emptyMessage}</p>

  return (
    <div className="flex flex-col gap-3">
      {/* The file list on top: a scannable overview and a jump target for each
          file. Bounded so a large comparison does not push every diff below a
          screen-tall table of contents. */}
      <nav
        className="overflow-hidden rounded border border-line bg-raised"
        aria-label="Changed files"
      >
        <div className="flex items-baseline gap-2 border-b border-line px-3 py-2 text-[12px] text-faint">
          <span>
            {files.length} file{files.length === 1 ? '' : 's'} changed
            {filesTruncated && ' (first 500)'}
          </span>
          <span className="ml-auto">
            <FileLineStats additions={totalAdditions} deletions={totalDeletions} />
          </span>
        </div>
        <ul className="max-h-64 overflow-auto py-1">
          {files.map((file, index) => (
            <li key={`${file.previousPath ?? ''}${file.path}`} className="flex items-center">
              <a
                href={`#${anchorId(index)}`}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1 hover:bg-rowhover"
                title={describeFileChange(file)}
              >
                <FileStatusIcon status={file.status} size={13} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                  {file.previousPath !== null && (
                    <span className="text-faint line-through">{file.previousPath} </span>
                  )}
                  {file.path}
                </span>
                {file.binary ? (
                  <span className="shrink-0 text-[10.5px] text-faint">binary</span>
                ) : (
                  <FileLineStats additions={file.additions} deletions={file.deletions} />
                )}
              </a>
              {/* The host's open-file seam (ADR-0031: on the row it opens), a
                  sibling of the jump link so it never triggers the anchor scroll. */}
              {onOpenFile && <OpenFileButton file={file} onOpenFile={onOpenFile} className="mr-2" />}
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-3">
        {files.map((file, index) => (
          <LazyFileDiffSection
            key={`${file.previousPath ?? ''}${file.path}`}
            file={file}
            index={index}
            loadFileDiff={loadFileDiff}
            mode={mode}
            diffViewTheme={diffViewTheme}
          />
        ))}
      </div>
    </div>
  )
}
