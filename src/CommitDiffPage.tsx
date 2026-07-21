import { useCallback, useEffect, useState } from 'react'
import { IconGitCommit, IconGitMerge } from '@tabler/icons-react'
import type { CommitDetail, CommitFileChange } from '../shared/git.schema'
import { fetchCommitDetail, fetchFileDiff } from './lib/api'
import { loadHighlighter } from './lib/highlighter'
import { parseCommitDiffParams } from './lib/diffRoutes'
import { useTheme } from './lib/theme'
import { DiffTabFrame } from './components/DiffTabFrame'
import { MultiFileDiffView } from './components'
import { CopyButton } from './components/CopyButton'
import { ThemeToggle } from './components/ThemeToggle'

// The full-commit tab — what "open this commit in a new tab" opens. Like the
// other pages it is an app shell: it owns the fetching (the commit's metadata
// and file list, then each file's diff on demand) and composes the fetch-free
// MultiFileDiffView.

export function CommitDiffPage() {
  const { themeMode, setThemeMode, resolvedTheme } = useTheme()
  const [params] = useState(() => parseCommitDiffParams(location.search))
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [isLoading, setIsLoading] = useState(params !== null)
  const [error, setError] = useState<string | null>(
    params === null ? 'This link is missing the commit it should show.' : null,
  )

  useEffect(() => {
    if (params === null) return
    let cancelled = false
    loadHighlighter().catch(() => {})
    fetchCommitDetail(params.repositoryRelativePath, params.commitHash)
      .then((loaded) => {
        if (!cancelled) setDetail(loaded)
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
    if (params !== null) {
      document.title = `${detail?.subject || params.commitHash} · commit · Git Graph`
    }
  }, [params, detail])

  // Only ever called from MultiFileDiffView, which renders only once `detail`
  // loaded — which cannot happen with null params — so params is present here.
  const loadFileDiff = useCallback(
    (file: CommitFileChange) => {
      if (params === null) return Promise.reject(new Error('no commit to diff'))
      return fetchFileDiff(params.repositoryRelativePath, params.commitHash, file.path)
    },
    [params],
  )

  const repositoryLabel = params?.repositoryRelativePath || '(root)'

  return (
    <DiffTabFrame
      header={
        <>
          <IconGitCommit size={18} className="shrink-0 text-accent" aria-hidden />
          <h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={detail?.subject}>
            {detail?.subject || (error !== null ? 'Commit unavailable' : 'Loading commit…')}
          </h1>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
            <span className="inline-flex items-center gap-1">
              commit
              <code className="font-mono text-fg">{detail?.hash || params?.commitHash || '—'}</code>
              <CopyButton value={detail?.fullHash || params?.commitHash || ''} label="commit hash" />
            </span>
            <span className="inline-flex items-center gap-1.5 text-faint">
              <IconGitMerge size={14} aria-hidden />
              {repositoryLabel}
            </span>
          </div>
          <ThemeToggle themeMode={themeMode} onSelectThemeMode={setThemeMode} />
        </>
      }
    >
      {error !== null ? (
        <p className="text-[#ff7b72]">{error}</p>
      ) : detail === null ? (
        <p className="text-faint">{isLoading ? 'Loading commit…' : 'No commit loaded.'}</p>
      ) : (
        <MultiFileDiffView
          files={detail.files}
          filesTruncated={detail.filesTruncated}
          loadFileDiff={loadFileDiff}
          emptyMessage={
            detail.parents.length > 1
              ? 'This merge brought in no changes of its own.'
              : 'This commit changed no files.'
          }
          diffViewTheme={resolvedTheme}
        />
      )}
    </DiffTabFrame>
  )
}
