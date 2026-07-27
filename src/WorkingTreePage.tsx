import { useCallback, useEffect, useState } from 'react'
import { IconGitCommit, IconPencil } from '@tabler/icons-react'
import type { CommitFileChange, WorkingTree } from '../shared/git.schema'
import { fetchWorkingFileDiff, fetchWorkingTree } from './lib/api'
import { loadHighlighter } from './lib/highlighter'
import { parseWorkingParams } from './lib/diffRoutes'
import { useTheme } from './lib/theme'
import { DiffTabFrame } from './components/DiffTabFrame'
import { MultiFileDiffView } from './components'
import { ThemeToggle } from './components/ThemeToggle'

// The working-tree tab — what the graph's "Uncommitted changes" node opens. It
// shows every uncommitted change (tracked modifications and deletions plus
// untracked files) measured against HEAD, each file's diff loaded on demand.
// Like the other pages it is an app shell: it owns the fetching and composes the
// fetch-free MultiFileDiffView.

export function WorkingTreePage() {
  const { themeMode, setThemeMode, resolvedTheme } = useTheme()
  const [params] = useState(() => parseWorkingParams(location.search))
  const [working, setWorking] = useState<WorkingTree | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadHighlighter().catch(() => {})
    fetchWorkingTree(params.repositoryRelativePath)
      .then((loaded) => {
        if (!cancelled) setWorking(loaded)
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
    const label = params.repositoryRelativePath || '(root)'
    document.title = `Uncommitted changes · ${label} · Git Graph`
  }, [params])

  const loadFileDiff = useCallback(
    (file: CommitFileChange) => fetchWorkingFileDiff(params.repositoryRelativePath, file.path),
    [params],
  )

  const repositoryLabel = params.repositoryRelativePath || '(root)'

  return (
    <DiffTabFrame
      header={
        <>
          <IconPencil size={18} className="shrink-0 text-accent" aria-hidden />
          <h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold">Uncommitted changes</h1>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
            {working?.branch && (
              <span className="inline-flex items-center gap-1" title="the checked-out branch">
                on
                <code className="font-mono text-fg">{working.branch}</code>
              </span>
            )}
            {working?.head && (
              <span className="inline-flex items-center gap-1" title="the commit the changes are measured against">
                vs
                <code className="font-mono text-fg">{working.head}</code>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-faint">
              <IconGitCommit size={14} aria-hidden />
              {repositoryLabel}
            </span>
          </div>
          <ThemeToggle themeMode={themeMode} onSelectThemeMode={setThemeMode} />
        </>
      }
    >
      {error !== null ? (
        <p className="text-[#ff7b72]">{error}</p>
      ) : working === null ? (
        <p className="text-faint">{isLoading ? 'Reading the working tree…' : 'No working tree loaded.'}</p>
      ) : (
        <MultiFileDiffView
          files={working.files}
          filesTruncated={working.filesTruncated}
          loadFileDiff={loadFileDiff}
          emptyMessage="Working tree clean — no uncommitted changes."
          diffViewTheme={resolvedTheme}
        />
      )}
    </DiffTabFrame>
  )
}
