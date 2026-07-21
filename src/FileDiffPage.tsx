import { useEffect, useState } from 'react'
import { IconArrowRight, IconFileDiff, IconGitMerge } from '@tabler/icons-react'
import type { FileDiff as FileDiffPayload } from '../shared/git.schema'
import { fetchFileDiff } from './lib/api'
import { loadHighlighter } from './lib/highlighter'
import { parseFileDiffParams } from './lib/diffRoutes'
import { FileDiff } from './components'
import { CopyButton } from './components/CopyButton'

// The standalone diff tab — what a cmd/ctrl/middle-click on a changed file
// opens. It is a second app shell alongside App.tsx: like App it owns all the
// fetching and chrome, and composes the fetch-free FileDiff renderer, here given
// the full window it does not get in the docked panel (split view, larger type).

/** The last path segment, for the tab title. */
function fileName(filePath: string) {
  const segments = filePath.split('/')
  return segments[segments.length - 1] || filePath
}

export function FileDiffPage() {
  // location.search never changes over this tab's life, so parse it once.
  const [params] = useState(() => parseFileDiffParams(location.search))
  const [diff, setDiff] = useState<FileDiffPayload | null>(null)
  const [isLoading, setIsLoading] = useState(params !== null)
  const [error, setError] = useState<string | null>(
    params === null ? 'This link is missing the commit or file it should show.' : null,
  )

  useEffect(() => {
    if (params === null) return
    let cancelled = false
    // Warm the highlighter in parallel with the fetch, as App does at startup.
    loadHighlighter().catch(() => {})
    fetchFileDiff(params.repositoryRelativePath, params.commitHash, params.filePath)
      .then((loaded) => {
        if (!cancelled) setDiff(loaded)
      })
      .catch((fetchError: Error) => {
        if (!cancelled) setError(fetchError.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [params])

  useEffect(() => {
    if (params !== null) document.title = `${fileName(params.filePath)} · ${params.commitHash} · Git Graph`
  }, [params])

  const repositoryLabel = params?.repositoryRelativePath || '(root)'

  return (
    <div className="flex h-screen w-screen flex-col bg-canvas font-sans text-[13px] text-fg">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-raised px-4 py-2.5">
        <IconFileDiff size={18} className="shrink-0 text-accent" aria-hidden />
        <h1 className="flex min-w-0 items-center gap-1.5 font-mono text-[12.5px]">
          {params !== null && diff?.previousPath && diff.previousPath !== params.filePath && (
            <span className="inline-flex min-w-0 items-center gap-1 text-faint">
              <span className="truncate line-through">{diff.previousPath}</span>
              <IconArrowRight size={13} className="shrink-0" aria-hidden />
            </span>
          )}
          <span className="truncate">{params?.filePath ?? 'File diff'}</span>
          {params !== null && <CopyButton value={params.filePath} label="file path" />}
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
          {params !== null && (
            <>
              <span className="inline-flex items-center gap-1">
                commit
                <code className="font-mono text-fg">{params.commitHash}</code>
                <CopyButton value={params.commitHash} label="commit hash" />
              </span>
              <span className="inline-flex items-center gap-1.5 text-faint">
                <IconGitMerge size={14} aria-hidden />
                {repositoryLabel}
              </span>
            </>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4">
        <FileDiff diff={diff} isLoading={isLoading} error={error} mode="split" wrap={false} fontSize={12.5} />
      </main>
    </div>
  )
}
