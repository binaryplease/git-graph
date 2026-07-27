import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconCircleCheck, IconGitMerge, IconPencil, IconSearch } from '@tabler/icons-react'
import type {
  BranchList,
  CommitDetail,
  CommitLog,
  FileDiff,
  GitCommit,
  RepositoryList,
  WorkingTree,
} from '../shared/git.schema'
import {
  fetchBranches,
  fetchCommitDetail,
  fetchCommitLog,
  fetchFileDiff,
  fetchRepositories,
  fetchWorkingTree,
} from './lib/api'
import { commitDiffHref, compareHref, fileDiffHref, workingHref } from './lib/diffRoutes'
import { loadHighlighter } from './lib/highlighter'
import { useTheme } from './lib/theme'
import { useDetailLayout } from './lib/detailLayout'
import { CommitGraph, CommitDetailPanel, type CommitGraphStats } from './components'
import { GRAPH_NODE_COLUMN_X, ROW_HEIGHT, graphContentLeft } from './components/CommitGraph'
import { FileLineStats } from './components/fileStatus'
import { ThemeToggle } from './components/ThemeToggle'
import { DetailLayoutToggle } from './components/DetailLayoutToggle'

// The graph's "Uncommitted changes" node — a synthetic row above HEAD, the way
// mhutchie's Git Graph and GitKraken mark the working tree at the top of
// history. It is rendered outside CommitGraph so the pinned layout algorithm
// never sees a non-commit. The leading glyph states which it is at a glance: a
// pencil (matching the /working tab's own header) when there are edits to view,
// a check when the tree is clean — never an ambiguous dashed ring that reads as
// a spinner or as pending changes. ADR-0022: real icons, not hand-drawn markers.
// The text is inset by `graphContentLeft(laneCount)` — the exact padding the
// commit rows use — so it lines up with the commit subjects below, and the icon
// sits in the graph gutter aligned to the node column. ADR-0031: adjacent to the
// history it summarises. ADR-0025: when the tree is clean the control stays
// visible and explains that there is nothing to open, rather than vanishing.
const MARKER_SIZE = 16
const markerStyle = { left: GRAPH_NODE_COLUMN_X - MARKER_SIZE / 2 }

function UncommittedChangesRow({
  working,
  href,
  contentLeft,
}: {
  working: WorkingTree
  href: string
  /** Left inset for the text, matching the commit rows' `graphContentLeft`. */
  contentLeft: number
}) {
  const fileCount = working.files.length
  const additions = working.files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = working.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)

  if (fileCount === 0) {
    return (
      <div
        className="relative flex items-center gap-2 border-b border-line pr-4 text-faint"
        style={{ height: ROW_HEIGHT, paddingLeft: contentLeft }}
        title="working tree clean — no uncommitted changes to view"
      >
        <IconCircleCheck
          size={MARKER_SIZE}
          className="absolute top-1/2 -translate-y-1/2"
          style={markerStyle}
          aria-hidden
        />
        <span className="text-[12px]">Working tree clean</span>
      </div>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="relative flex items-center gap-2 border-b border-line pr-4 hover:bg-rowhover"
      style={{ height: ROW_HEIGHT, paddingLeft: contentLeft }}
      title={`view ${fileCount} uncommitted change${fileCount === 1 ? '' : 's'} in a new tab`}
    >
      <IconPencil
        size={MARKER_SIZE}
        className="absolute top-1/2 -translate-y-1/2 text-accent"
        style={markerStyle}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-[12px] text-accent">
        Uncommitted changes
        <span className="ml-2 text-faint">
          {fileCount} file{fileCount === 1 ? '' : 's'}
          {working.filesTruncated && '+'}
        </span>
      </span>
      <FileLineStats additions={additions} deletions={deletions} />
    </a>
  )
}

export function App() {
  const { themeMode, setThemeMode, resolvedTheme } = useTheme()
  const { detailLayout, setDetailLayout } = useDetailLayout()
  const [repositoryList, setRepositoryList] = useState<RepositoryList | null>(null)
  // The selected repository's relativePath — '' is a valid value (the served
  // root itself is a repository), so "nothing selected" is null.
  const [selectedRepository, setSelectedRepository] = useState<string | null>(null)
  const [commitLog, setCommitLog] = useState<CommitLog | null>(null)
  // Branches of the selected repository — the default one is the base a "compare
  // against main" affordance diffs against, and knowing it lets the panel hide
  // the affordance on the default branch itself.
  const [branchList, setBranchList] = useState<BranchList | null>(null)
  // The selected repository's uncommitted changes — drives the "Uncommitted
  // changes" node at the top of the graph. A failure here is not fatal to the
  // graph, so it only leaves the node absent rather than raising an error.
  const [workingTree, setWorkingTree] = useState<WorkingTree | null>(null)
  const [isLoadingLog, setIsLoadingLog] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [graphStats, setGraphStats] = useState<CommitGraphStats>({
    laneCount: 0,
    matchCount: null,
  })
  // The commit whose details are open. The hash is the selection; the detail is
  // fetched for it, so the panel can show the hash while the payload is in
  // flight and after a failure.
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null)
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  // The file whose diff is open in the panel, and the diff fetched for it —
  // same shape as the commit selection above, one level down.
  const [expandedFilePath, setExpandedFilePath] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null)
  const [isLoadingFileDiff, setIsLoadingFileDiff] = useState(false)
  const [fileDiffError, setFileDiffError] = useState<string | null>(null)

  // Loading a syntax grammar the first time a diff is expanded costs about half
  // a second; warming the highlighter here spends it while nobody is waiting.
  useEffect(() => {
    loadHighlighter().catch(() => {
      // A failed warm-up is not an app-level error — FileDiff retries on expand
      // and reports the failure where the diff would have been.
    })
  }, [])

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
    // The branch listing drives the compare affordances; a failure there is not
    // fatal to the graph, so it only clears the list rather than raising an error.
    setBranchList(null)
    fetchBranches(selectedRepository)
      .then((list) => {
        if (!cancelled) setBranchList(list)
      })
      .catch(() => {})
    // The working tree drives the "Uncommitted changes" node; like the branch
    // listing a failure there is not fatal to the graph, so it is swallowed.
    setWorkingTree(null)
    fetchWorkingTree(selectedRepository)
      .then((tree) => {
        if (!cancelled) setWorkingTree(tree)
      })
      .catch(() => {})
    // Deep-linkable selection with natural back-button-free history.
    const parameters = new URLSearchParams(location.search)
    parameters.set('repo', selectedRepository)
    history.replaceState(null, '', `?${parameters}`)
    return () => {
      cancelled = true
    }
  }, [selectedRepository])

  // Switching repositories invalidates any open commit — its hash belongs to
  // the previous history.
  useEffect(() => setSelectedCommitHash(null), [selectedRepository])

  // Fetch the details of whatever commit is selected.
  useEffect(() => {
    if (selectedRepository === null || selectedCommitHash === null) {
      setCommitDetail(null)
      setDetailError(null)
      return
    }
    let cancelled = false
    setIsLoadingDetail(true)
    setDetailError(null)
    setCommitDetail(null)
    fetchCommitDetail(selectedRepository, selectedCommitHash)
      .then((detail) => {
        if (!cancelled) setCommitDetail(detail)
      })
      .catch((error: Error) => {
        if (!cancelled) setDetailError(error.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDetail(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRepository, selectedCommitHash])

  // Selecting another commit invalidates the open file — its path belongs to
  // the previous commit's listing.
  useEffect(() => setExpandedFilePath(null), [selectedCommitHash])

  // Fetch the diff of whatever file is expanded.
  useEffect(() => {
    if (selectedRepository === null || selectedCommitHash === null || expandedFilePath === null) {
      setFileDiff(null)
      setFileDiffError(null)
      return
    }
    let cancelled = false
    setIsLoadingFileDiff(true)
    setFileDiffError(null)
    setFileDiff(null)
    fetchFileDiff(selectedRepository, selectedCommitHash, expandedFilePath)
      .then((diff) => {
        if (!cancelled) setFileDiff(diff)
      })
      .catch((error: Error) => {
        if (!cancelled) setFileDiffError(error.message)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFileDiff(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRepository, selectedCommitHash, expandedFilePath])

  const handleToggleFile = useCallback(
    (filePath: string) => setExpandedFilePath((current) => (current === filePath ? null : filePath)),
    [],
  )

  const handleGraphStats = useCallback((stats: CommitGraphStats) => setGraphStats(stats), [])
  // Clicking a row toggles its detail: selecting a new commit opens it, clicking
  // the already-open one closes it (so the inline expansion collapses on a second
  // click of its own row). Parent navigation from the panel sets the hash
  // directly, so it never toggles itself shut.
  const handleSelectCommit = useCallback(
    (commit: GitCommit) =>
      setSelectedCommitHash((currentHash) => (currentHash === commit.hash ? null : commit.hash)),
    [],
  )

  // The app shell owns the route scheme (App.tsx does all fetching and routing);
  // the panel only turns these strings into links for the file it opens.
  const buildFileDiffHref = useCallback(
    (filePath: string) =>
      selectedRepository === null || selectedCommitHash === null
        ? null
        : fileDiffHref(selectedRepository, selectedCommitHash, filePath),
    [selectedRepository, selectedCommitHash],
  )

  const buildCommitDiffHref = useCallback(
    () =>
      selectedRepository === null || selectedCommitHash === null
        ? null
        : commitDiffHref(selectedRepository, selectedCommitHash),
    [selectedRepository, selectedCommitHash],
  )

  const defaultBranch = branchList?.defaultBranch ?? null
  const buildCompareHref = useCallback(
    (branchName: string) => {
      // Nothing to compare a branch against without a repository, and comparing
      // the default branch against itself is always empty — skip both.
      if (selectedRepository === null || branchName === defaultBranch) return null
      return compareHref(selectedRepository, branchName)
    },
    [selectedRepository, defaultBranch],
  )

  const repositories = repositoryList?.repositories ?? []
  const commits = commitLog?.commits ?? []
  const hasCommits = commits.length > 0

  const loadedHashes = useMemo(() => new Set(commits.map((commit) => commit.hash)), [commits])
  const isCommitLoaded = useCallback((commitHash: string) => loadedHashes.has(commitHash), [loadedHashes])

  // Esc closes the panel; ↑/↓ walk the graph while it is open, so a commit can
  // be read through without going back to the mouse. Typing in the search box
  // keeps its own arrow-key behaviour.
  useEffect(() => {
    if (selectedCommitHash === null) return
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.isContentEditable) {
        if (event.key !== 'Escape') return
      }
      if (event.key === 'Escape') {
        setSelectedCommitHash(null)
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const currentRow = commits.findIndex((commit) => commit.hash === selectedCommitHash)
      if (currentRow < 0) return
      const nextRow = currentRow + (event.key === 'ArrowDown' ? 1 : -1)
      const nextCommit = commits[nextRow]
      if (!nextCommit) return
      event.preventDefault()
      setSelectedCommitHash(nextCommit.hash)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commits, selectedCommitHash])

  const readout = [
    hasCommits &&
      `${commits.length}${commitLog?.truncated ? '+' : ''} commits · ${graphStats.laneCount} lane${graphStats.laneCount === 1 ? '' : 's'}`,
    graphStats.matchCount !== null &&
      hasCommits &&
      `${graphStats.matchCount} match${graphStats.matchCount === 1 ? '' : 'es'}`,
  ]
    .filter(Boolean)
    .join(' · ')

  // Built once so the sidebar and inline mounts render the identical panel — the
  // variant it carries decides its frame (ADR-0027: one component, the detail is
  // the invariant). The layout toggle rides on the panel's own header (ADR-0031:
  // a view-mode toggle for the detail surface, not app-global chrome).
  const detailPanel =
    selectedCommitHash === null ? null : (
      <CommitDetailPanel
        variant={detailLayout}
        headerActions={
          <DetailLayoutToggle detailLayout={detailLayout} onSelectDetailLayout={setDetailLayout} />
        }
        detail={commitDetail}
        isLoading={isLoadingDetail}
        error={detailError}
        requestedHash={selectedCommitHash}
        onSelectCommit={setSelectedCommitHash}
        isCommitLoaded={isCommitLoaded}
        expandedFilePath={expandedFilePath}
        onToggleFile={handleToggleFile}
        buildFileDiffHref={buildFileDiffHref}
        buildCommitDiffHref={buildCommitDiffHref}
        buildCompareHref={buildCompareHref}
        fileDiff={fileDiff}
        isLoadingFileDiff={isLoadingFileDiff}
        fileDiffError={fileDiffError}
        diffViewTheme={resolvedTheme}
        onClose={() => setSelectedCommitHash(null)}
      />
    )

  return (
    // The standalone shell is capped at 1440×900 and centred: the graph is a
    // dense, fixed-width-ish reading surface, so letting it stretch across an
    // ultrawide display only pushes the readout away from the rows. Below the
    // cap it fills the viewport as before.
    <div className="flex h-screen w-screen items-center justify-center bg-backdrop">
      <div className="flex h-full max-h-[900px] w-full max-w-[1440px] flex-col overflow-hidden rounded-lg border border-line bg-canvas font-sans text-[13px] text-fg shadow-2xl shadow-black/60">
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

            <ThemeToggle themeMode={themeMode} onSelectThemeMode={setThemeMode} />
          </div>
        </header>

        <main className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1 overflow-auto">
          {/* The working tree sits at the top of history, above HEAD — ADR-0031:
              adjacent to the graph it summarises. Shown once loaded whenever a
              repository is selected, even before the log arrives or when the
              repo has no commits yet (a fresh repo's untracked files still
              count as uncommitted changes worth seeing). */}
          {loadError === null && selectedRepository !== null && workingTree !== null && (
            <UncommittedChangesRow
              working={workingTree}
              href={workingHref(selectedRepository)}
              contentLeft={graphContentLeft(graphStats.laneCount)}
            />
          )}
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
            <CommitGraph
              commits={commits}
              searchQuery={searchQuery.trim()}
              onStats={handleGraphStats}
              selectedHash={selectedCommitHash}
              onSelectCommit={handleSelectCommit}
              // Inline is the default: the detail expands in-flow beneath the
              // selected row. In sidebar mode the graph stays unbroken and the
              // panel docks to the right instead.
              selectedDetail={detailLayout === 'inline' ? detailPanel : null}
            />
          )}
          </div>

          {detailLayout === 'sidebar' && detailPanel}
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
    </div>
  )
}
