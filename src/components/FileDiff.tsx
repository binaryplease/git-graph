import { useEffect, useState, type ReactNode } from 'react'
import { DiffModeEnum, DiffView, DiffFile as DiffViewFile } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import type { FileDiff as FileDiffPayload } from '../../shared/git.schema'
import { loadHighlighter } from '../lib/highlighter'

// One file's diff, rendered. Like CommitGraph and CommitDetailPanel this fetches
// nothing and owns no app chrome: a loaded payload, a loading flag or an error
// comes in, rows go out, so the component lifts into another host as-is.
//
// The layout is a prop: the docked panel keeps the default unified, wrapped view
// (it rarely has the width for two columns), while the standalone diff tab, with
// a full window, opts into a side-by-side layout.

type DiffBuild =
  | { state: 'pending' }
  | { state: 'ready'; diffViewFile: DiffViewFile }
  | { state: 'failed'; message: string }

export type FileDiffProps = {
  /** The loaded diff, or null while loading or after a failure. */
  diff: FileDiffPayload | null
  isLoading: boolean
  error: string | null
  /**
   * Presentation, defaulted to the docked panel's cramped-column settings.
   * The standalone diff tab has a full window, so it overrides these to a
   * side-by-side, unwrapped, slightly larger view.
   */
  mode?: 'unified' | 'split'
  wrap?: boolean
  fontSize?: number
  /**
   * The @git-diff-view colour scheme. Defaults to `dark` — the standalone app's
   * single GitHub-dark palette — so this repo's own callers are unchanged. An
   * embedding host (nightshift-ui) with a live light/dark theme passes its
   * resolved scheme so the diff body flips with the host rather than staying dark.
   */
  diffViewTheme?: 'light' | 'dark'
}

/**
 * A git blob ends with a newline, which splits into a phantom final empty line
 * the patch has no counterpart for — the viewer notices the off-by-one when it
 * lines file content up against the diff to expand context. Dropping exactly
 * one trailing newline makes the two agree; a file that genuinely ends without
 * one is left alone.
 */
function withoutTrailingNewline(content: string | null) {
  return content === null ? null : content.replace(/\n$/, '')
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1.5 text-[11.5px] text-faint">{children}</p>
}

export function FileDiff({
  diff,
  isLoading,
  error,
  mode = 'unified',
  wrap = true,
  fontSize = 11.5,
  diffViewTheme = 'dark',
}: FileDiffProps) {
  const [build, setBuild] = useState<DiffBuild>({ state: 'pending' })

  // Building is the expensive step — tokenizing both complete files runs on the
  // order of 100 ms — so it happens off the render path and behind a pending
  // state rather than blocking the disclosure from opening.
  useEffect(() => {
    if (diff === null || diff.binary || diff.truncated || diff.hunks.length === 0) return
    let cancelled = false
    setBuild({ state: 'pending' })
    loadHighlighter(diff.language)
      .then((highlighter) => {
        if (cancelled) return
        const diffViewFile = DiffViewFile.createInstance({
          oldFile: {
            fileName: diff.previousPath ?? diff.path,
            fileLang: diff.language,
            content: withoutTrailingNewline(diff.oldSource),
          },
          newFile: {
            fileName: diff.path,
            fileLang: diff.language,
            content: withoutTrailingNewline(diff.newSource),
          },
          hunks: diff.hunks,
        })
        diffViewFile.initRaw()
        diffViewFile.initSyntax({ registerHighlighter: highlighter })
        // Build both layouts so switching `mode` never needs a costly rebuild —
        // the DiffView just reads whichever the mode selects.
        diffViewFile.buildUnifiedDiffLines()
        diffViewFile.buildSplitDiffLines()
        setBuild({ state: 'ready', diffViewFile })
      })
      .catch((buildError: Error) => {
        if (!cancelled) setBuild({ state: 'failed', message: buildError.message })
      })
    return () => {
      cancelled = true
    }
  }, [diff])

  if (error !== null) return <Notice>{error}</Notice>
  if (diff === null) return <Notice>{isLoading ? 'Loading diff…' : 'No diff loaded.'}</Notice>

  // ADR-0025: these say what happened instead of rendering an empty box.
  if (diff.binary) return <Notice>Binary file — git reports no line-by-line diff.</Notice>
  if (diff.truncated) {
    return <Notice>This diff is too large to display. Open the file in your editor instead.</Notice>
  }
  if (diff.hunks.length === 0) {
    return <Notice>No textual changes — only the file mode or metadata changed.</Notice>
  }

  if (build.state === 'failed') return <Notice>Could not render this diff: {build.message}</Notice>
  if (build.state === 'pending') return <Notice>Highlighting…</Notice>

  return (
    <div className="overflow-hidden rounded border border-line bg-canvas">
      {/* Wrapped, not scrolled: the panel is 26rem wide, and a horizontal
          scrollbar per file makes reading a diff a chore. */}
      <DiffView
        diffFile={build.diffViewFile}
        diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
        diffViewTheme={diffViewTheme}
        diffViewHighlight
        diffViewWrap={wrap}
        diffViewFontSize={fontSize}
      />
    </div>
  )
}
