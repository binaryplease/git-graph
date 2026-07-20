import { useCallback, useEffect, useState } from 'react'
import { IconArrowRight, IconGitBranch, IconGitMerge } from '@tabler/icons-react'
import type { BranchList, CommitFileChange, CompareSummary } from '../shared/git.schema'
import { fetchBranches, fetchCompareFileDiff, fetchCompareSummary } from './lib/api'
import { loadHighlighter } from './lib/highlighter'
import { compareHref, parseCompareParams } from './lib/diffRoutes'
import { DiffTabFrame } from './components/DiffTabFrame'
import { MultiFileDiffView } from './components/MultiFileDiffView'

// The branch-comparison tab — what "compare this branch against main" opens. An
// omitted base means the repository default branch (resolved on the server), and
// a base selector lets the reader diff against any other branch. Like the other
// pages it owns the fetching and composes the fetch-free MultiFileDiffView.

export function ComparePage() {
  const [params] = useState(() => parseCompareParams(location.search))
  const [summary, setSummary] = useState<CompareSummary | null>(null)
  const [branchList, setBranchList] = useState<BranchList | null>(null)
  const [isLoading, setIsLoading] = useState(params !== null)
  const [error, setError] = useState<string | null>(
    params === null ? 'This link is missing the branch it should compare.' : null,
  )

  useEffect(() => {
    if (params === null) return
    let cancelled = false
    loadHighlighter().catch(() => {})
    // The branch list drives the base selector; a failure there is not fatal to
    // the comparison itself, so it is swallowed rather than shown as an error.
    fetchBranches(params.repositoryRelativePath)
      .then((loaded) => {
        if (!cancelled) setBranchList(loaded)
      })
      .catch(() => {})
    fetchCompareSummary(params.repositoryRelativePath, params.headBranch, params.baseBranch)
      .then((loaded) => {
        if (!cancelled) setSummary(loaded)
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
      const base = summary?.base || params.baseBranch || 'default'
      document.title = `${params.headBranch} vs ${base} · compare · Git Graph`
    }
  }, [params, summary])

  const loadFileDiff = useCallback(
    (file: CommitFileChange) => {
      if (params === null) return Promise.reject(new Error('no branch to compare'))
      return fetchCompareFileDiff(
        params.repositoryRelativePath,
        params.headBranch,
        file.path,
        params.baseBranch,
      )
    },
    [params],
  )

  const repositoryLabel = params?.repositoryRelativePath || '(root)'
  const resolvedBase = summary?.base ?? params?.baseBranch ?? ''

  return (
    <DiffTabFrame
      header={
        <>
          <IconGitBranch size={18} className="shrink-0 text-accent" aria-hidden />
          <h1 className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
            {/* base ← head: the base is a selector so the reader can diff the
                same branch against another (ADR-0031: the control sits on the
                thing it changes). */}
            <label className="inline-flex items-center gap-1.5">
              <span className="text-faint">base</span>
              <select
                className="max-w-[12rem] truncate rounded-md border border-line bg-canvas px-2 py-0.5 font-mono text-[12px] text-fg focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                value={resolvedBase}
                disabled={params === null || branchList === null || branchList.branches.length === 0}
                title={
                  branchList === null
                    ? 'loading branches…'
                    : 'choose the branch to compare against'
                }
                onChange={(event) => {
                  if (params !== null) {
                    location.assign(compareHref(params.repositoryRelativePath, params.headBranch, event.target.value))
                  }
                }}
              >
                {/* Keep the resolved base selectable even before the branch list
                    arrives, so the control is never empty. */}
                {branchList === null && resolvedBase && (
                  <option value={resolvedBase}>{resolvedBase}</option>
                )}
                {branchList?.branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                    {branch.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <IconArrowRight size={15} className="shrink-0 text-faint" aria-hidden />
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="text-faint">head</span>
              <code className="truncate font-mono text-[12px] text-fg" title={params?.headBranch}>
                {params?.headBranch ?? '—'}
              </code>
            </span>
          </h1>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
            {summary?.mergeBase && (
              <span className="inline-flex items-center gap-1" title="where the branches diverged">
                merge base
                <code className="font-mono text-fg">{summary.mergeBase}</code>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-faint">
              <IconGitMerge size={14} aria-hidden />
              {repositoryLabel}
            </span>
          </div>
        </>
      }
    >
      {error !== null ? (
        <p className="text-[#ff7b72]">{error}</p>
      ) : summary === null ? (
        <p className="text-faint">{isLoading ? 'Comparing branches…' : 'No comparison loaded.'}</p>
      ) : (
        <MultiFileDiffView
          files={summary.files}
          filesTruncated={summary.filesTruncated}
          loadFileDiff={loadFileDiff}
          emptyMessage={`${summary.head} has no changes relative to ${summary.base}.`}
        />
      )}
    </DiffTabFrame>
  )
}
