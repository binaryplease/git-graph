import { useCallback, useEffect, useState } from 'react'
import { IconGitMerge, IconSearch } from '@tabler/icons-react'
import type { CommitLog, RepositoryList } from '../shared/git.schema'
import { fetchCommitLog, fetchRepositories } from './lib/api'
import { CommitGraph, type CommitGraphStats } from './components/CommitGraph'

export function App() {
  const [repositoryList, setRepositoryList] = useState<RepositoryList | null>(null)
  // The selected repository's relativePath — '' is a valid value (the served
  // root itself is a repository), so "nothing selected" is null.
  const [selectedRepository, setSelectedRepository] = useState<string | null>(null)
  const [commitLog, setCommitLog] = useState<CommitLog | null>(null)
  const [isLoadingLog, setIsLoadingLog] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [graphStats, setGraphStats] = useState<CommitGraphStats>({
    laneCount: 0,
    matchCount: null,
  })

  useEffect(() => {
    fetchRepositories()
      .then((list) => {
        setRepositoryList(list)
        const requested = new URLSearchParams(location.search).get('repo')
        const deepLinked =
          requested !== null &&
          list.repositories.find((repository) => repository.relativePath === requested)
        const initial = deepLinked || list.repositories[0]
        setSelectedRepository(initial ? initial.relativePath : null)
      })
      .catch((error: Error) => setLoadError(error.message))
  }, [])

  useEffect(() => {
    if (selectedRepository === null) return
    let cancelled = false
    setIsLoadingLog(true)
    setLoadError(null)
    fetchCommitLog(selectedRepository)
      .then((log) => {
        if (!cancelled) setCommitLog(log)
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLog(false)
      })
    // Deep-linkable selection with natural back-button-free history.
    const parameters = new URLSearchParams(location.search)
    parameters.set('repo', selectedRepository)
    history.replaceState(null, '', `?${parameters}`)
    return () => {
      cancelled = true
    }
  }, [selectedRepository])

  const handleGraphStats = useCallback((stats: CommitGraphStats) => setGraphStats(stats), [])

  const repositories = repositoryList?.repositories ?? []
  const commits = commitLog?.commits ?? []
  const hasCommits = commits.length > 0

  const readout = [
    hasCommits &&
      `${commits.length}${commitLog?.truncated ? '+' : ''} commits · ${graphStats.laneCount} lane${graphStats.laneCount === 1 ? '' : 's'}`,
    graphStats.matchCount !== null &&
      hasCommits &&
      `${graphStats.matchCount} match${graphStats.matchCount === 1 ? '' : 'es'}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-screen flex-col bg-canvas font-sans text-[13px] text-fg">
      <header className="flex flex-wrap items-center gap-3.5 border-b border-line bg-raised px-4 py-2.5">
        <div className="flex items-center gap-2 font-semibold">
          <IconGitMerge size={20} className="text-accent" aria-hidden />
          <span>
            Git Graph <small className="font-normal text-faint">binp-git-graph</small>
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-1.5 text-dim">
            repository
            <select
              className="rounded-md border border-line bg-canvas px-2 py-1 text-fg focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
              value={selectedRepository ?? ''}
              disabled={repositories.length === 0}
              // ADR-0025: disabled controls explain why, never vanish.
              title={
                repositories.length === 0
                  ? 'no git repositories found at the served root — set GIT_GRAPH_ROOT'
                  : undefined
              }
              onChange={(event) => setSelectedRepository(event.target.value)}
            >
              {repositories.length === 0 && <option value="">no repositories found</option>}
              {repositories.map((repository) => (
                <option key={repository.relativePath} value={repository.relativePath}>
                  {repository.name}
                </option>
              ))}
            </select>
          </label>

          <div className="relative flex items-center">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-2 text-faint"
              aria-hidden
            />
            <input
              type="text"
              className="w-60 rounded-md border border-line bg-canvas py-1 pr-2 pl-7 text-fg placeholder:text-faint focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
              placeholder={
                hasCommits ? 'fuzzy search subject / hash / author' : 'load commits to search'
              }
              disabled={!hasCommits}
              title={hasCommits ? undefined : 'search enables once a repository with commits is loaded'}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <span className="text-faint tabular-nums">{readout}</span>
        </div>
      </header>

      <main className="relative flex-1 overflow-auto">
        {loadError !== null && (
          <p className="px-4 py-6 text-[#ff7b72]">
            {loadError}
          </p>
        )}
        {loadError === null && repositoryList !== null && repositories.length === 0 && (
          <p className="px-4 py-6 text-faint">
            No git repositories found under{' '}
            <code className="font-mono text-dim">{repositoryList.rootPath}</code>. Point the server
            at a projects folder: set <code className="font-mono text-dim">GIT_GRAPH_ROOT</code> or
            run <code className="font-mono text-dim">bun server/index.ts ~/projects</code>.
          </p>
        )}
        {loadError === null && selectedRepository !== null && !isLoadingLog && commitLog !== null && !hasCommits && (
          <p className="px-4 py-6 text-faint">This repository has no commits yet.</p>
        )}
        {loadError === null && isLoadingLog && commitLog === null && (
          <p className="px-4 py-6 text-faint">Loading commit history…</p>
        )}
        {loadError === null && hasCommits && (
          <CommitGraph commits={commits} searchQuery={searchQuery.trim()} onStats={handleGraphStats} />
        )}
      </main>

      <footer className="flex flex-wrap gap-4 border-t border-line bg-raised px-4 py-1.5 text-[11.5px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[9px] w-[9px] rounded-full bg-accent" /> commit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[9px] w-[9px] rounded-full border-2 border-dim" /> merge
          (2+ parents)
        </span>
        <span>color = lane / branch column</span>
        {graphStats.matchCount === 0 && hasCommits && <span>no rows match your search</span>}
      </footer>
    </div>
  )
}
