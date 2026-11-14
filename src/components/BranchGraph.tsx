import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { IconChevronRight, IconChevronsDown } from '@tabler/icons-react'
import type { GitCommit } from '../../shared/git.schema'
import { computeBranchTree, lineLeftBy } from '../../shared/branchTree'
import { fuzzyHighlight } from '../../shared/fuzzy'
import { groupRefDecorations } from '../../shared/refGroup'
import {
  FuzzySegments,
  NODE_RADIUS,
  ROW_HEIGHT,
  graphColumnWidth,
  graphContentLeft,
  laneColor,
  laneX,
} from './CommitGraph'
import { CommitRefRow } from './RefPill'

// The Branches view (concept "git-graph: Branch-Ansicht", variant A2 "Nur
// Refs"): one row per ref, the repository drawn as a tree of branch lines, and a
// line's commits listed beneath its row once the row is opened. Commits in, SVG
// + rows out, like CommitGraph: no fetching and no app chrome, so a host mounts
// it as-is. The model — rows, lines, order, lanes, merges, merged-in side
// commits — is `computeBranchTree` in `git-graph/shared`; this file draws it.
//
// Lanes come from the model alone, so opening or closing a row moves rows up
// and down but never moves a lane sideways.

/** An open line lists this many commits, then a "show N more commits" row. */
export const BRANCH_LINE_COMMIT_LIMIT = 25

// The row background, set on every row so an unset variable never blanks it.
const NO_TINT = { '--line-tint': 'transparent' } as CSSProperties
const SELECTED_TINT = { '--line-tint': 'var(--color-rowselected)' } as CSSProperties

const REF_NODE_RADIUS = 3.75
const COMMIT_DOT_RADIUS = 2.5
const LINE_WIDTH = 2
/** How far above its end a line starts bending into the lane it joins. */
const BEND_HEIGHT = ROW_HEIGHT / 2
/** A line whose fork is below the window runs this far past the last row. */
const OPEN_END_OVERHANG = 6

const DAY_MILLISECONDS = 86_400_000

/** "today", "3 days ago", "5 weeks ago", … from a `YYYY-MM-DD` author date. */
export function relativeAge(date: string, now: number): string {
  const time = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(time)) return date
  const days = Math.floor((now - time) / DAY_MILLISECONDS)
  if (days < 1) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 14) return `${days} days ago`
  if (days < 63) return `${Math.round(days / 7)} weeks ago`
  if (days < 730) return `${Math.round(days / 30.44)} months ago`
  return `${Math.round(days / 365.25)} years ago`
}

export type BranchGraphStats = {
  laneCount: number
  /** Number of ref rows. */
  refCount: number
  /** Number of commits matching the search query; null when there is no query. */
  matchCount: number | null
}

export type BranchGraphProps = {
  /** Commits in topological order (children before all of their parents). */
  commits: GitCommit[]
  /** The repository's remote names (`CommitLog.remotes`); required for the reason `CommitGraph` gives. */
  remotes: string[]
  /**
   * The default branch from the branch listing; its line takes lane 0 and is
   * handed out first. Null while unknown — every ref still gets a line.
   */
  defaultBranch: string | null
  /** Whether a tag-only commit gets a row of its own. */
  tagsAsRows: boolean
  /** Fuzzy search query; lines holding a match open, the rest dim. */
  searchQuery?: string
  /** Reports derived numbers for host chrome. Pass a stable callback. */
  onStats?: (stats: BranchGraphStats) => void
  /** Hash of the selected commit; its line opens to show it. */
  selectedHash?: string | null
  /** Called when a commit row is activated by click or keyboard. */
  onSelectCommit?: (commit: GitCommit) => void
  /** Called on Escape, and when the line holding the selected commit is closed. */
  onClearSelection?: () => void
  /** Detail to expand in-flow beneath the selected commit row; see `CommitGraph`. */
  selectedDetail?: ReactNode
  /** The time ages are measured from; defaults to now. */
  now?: number
}

type Item =
  | { kind: 'ref'; key: string; hash: string; line: string }
  | { kind: 'commit'; key: string; hash: string; line: string }
  | { kind: 'more'; key: string; line: string; hidden: number }
  | { kind: 'side'; key: string; hash: string; line: string; mergeHash: string }

const addTo = (set: ReadonlySet<string>, value: string) => (set.has(value) ? set : new Set(set).add(value))
const removeFrom = (set: ReadonlySet<string>, value: string) => {
  if (!set.has(value)) return set
  const next = new Set(set)
  next.delete(value)
  return next
}

export function BranchGraph({
  commits,
  remotes,
  defaultBranch,
  tagsAsRows,
  searchQuery = '',
  onStats,
  selectedHash = null,
  onSelectCommit,
  onClearSelection,
  selectedDetail = null,
  now,
}: BranchGraphProps) {
  const model = useMemo(
    () => computeBranchTree({ commits, remotes, defaultBranch, tagsAreRows: tagsAsRows }),
    [commits, remotes, defaultBranch, tagsAsRows],
  )
  const commitByHash = useMemo(() => new Map(commits.map((commit) => [commit.hash, commit])), [commits])
  const refGroupsOf = useCallback(
    (hash: string) => groupRefDecorations(commitByHash.get(hash)?.refs ?? [], remotes),
    [commitByHash, remotes],
  )
  // Side commit → the merge that brought it in.
  const mergeOfSideCommit = useMemo(() => {
    const mergeOf = new Map<string, string>()
    for (const [mergeHash, sideCommits] of model.mergedBy) for (const hash of sideCommits) mergeOf.set(hash, mergeHash)
    return mergeOf
  }, [model])
  /** The line a commit is shown on: its own, or for a side commit the line of its merge. */
  const lineOfCommit = useCallback(
    (hash: string) => model.runOf.get(hash) ?? model.runOf.get(mergeOfSideCommit.get(hash) ?? ''),
    [model, mergeOfSideCommit],
  )

  // Search: which commits match, and which lines hold one.
  const matchedHashes = useMemo(() => {
    const matched = new Set<string>()
    if (!searchQuery) return matched
    for (const commit of commits) {
      if (
        fuzzyHighlight(commit.subject, searchQuery).matched ||
        fuzzyHighlight(commit.hash, searchQuery).matched ||
        fuzzyHighlight(commit.author, searchQuery).matched
      ) {
        matched.add(commit.hash)
      }
    }
    return matched
  }, [commits, searchQuery])
  const linesWithMatches = useMemo(() => {
    const lines = new Set<string>()
    for (const hash of matchedHashes) {
      const line = model.runOf.get(hash)
      if (line !== undefined) lines.add(line)
    }
    return lines
  }, [matchedHashes, model])

  // Open state. A line opens when its row is opened, or when it holds a match
  // (unless its row was closed during this search).
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set())
  const [fullyShownRows, setFullyShownRows] = useState<ReadonlySet<string>>(() => new Set())
  const [closedDuringSearch, setClosedDuringSearch] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => setClosedDuringSearch(new Set()), [searchQuery])
  const isOpen = useCallback(
    (rowHash: string) =>
      openRows.has(rowHash) || (linesWithMatches.has(rowHash) && !closedDuringSearch.has(rowHash)),
    [openRows, linesWithMatches, closedDuringSearch],
  )

  // A selection made elsewhere (a parent link in the detail panel) opens the
  // line that shows it, far enough down to reach it.
  useEffect(() => {
    if (selectedHash === null) return
    const line = lineOfCommit(selectedHash)
    if (line === undefined) return
    const anchor = model.runOf.has(selectedHash) ? selectedHash : mergeOfSideCommit.get(selectedHash)!
    setOpenRows((current) => addTo(current, line))
    setClosedDuringSearch((current) => removeFrom(current, line))
    if (model.run.get(line)!.indexOf(anchor) >= BRANCH_LINE_COMMIT_LIMIT) {
      setFullyShownRows((current) => addTo(current, line))
    }
  }, [selectedHash, lineOfCommit, model, mergeOfSideCommit])

  const toggleRow = useCallback(
    (rowHash: string) => {
      if (isOpen(rowHash)) {
        setOpenRows((current) => removeFrom(current, rowHash))
        if (linesWithMatches.has(rowHash)) setClosedDuringSearch((current) => addTo(current, rowHash))
        if (selectedHash !== null && lineOfCommit(selectedHash) === rowHash) onClearSelection?.()
      } else {
        setOpenRows((current) => addTo(current, rowHash))
        setClosedDuringSearch((current) => removeFrom(current, rowHash))
      }
    },
    [isOpen, linesWithMatches, selectedHash, lineOfCommit, onClearSelection],
  )

  // The visible items, in tree order: each ref row, then the shown commits of
  // open lines at their own places in the order.
  const items = useMemo(() => {
    const shownCommits = new Set<string>()
    const moreAfter = new Map<string, { line: string; hidden: number }>()
    for (const rowHash of model.rows) {
      if (!isOpen(rowHash)) continue
      const run = model.run.get(rowHash)!
      const showAll = fullyShownRows.has(rowHash) || linesWithMatches.has(rowHash)
      const shown = showAll ? run : run.slice(0, BRANCH_LINE_COMMIT_LIMIT)
      for (const hash of shown) shownCommits.add(hash)
      if (shown.length < run.length) {
        moreAfter.set(shown[shown.length - 1]!, { line: rowHash, hidden: run.length - shown.length })
      }
    }
    const selectedMerge = selectedHash === null ? undefined : mergeOfSideCommit.get(selectedHash)
    const list: Item[] = []
    for (const hash of model.order) {
      if (model.lane.has(hash)) list.push({ kind: 'ref', key: `ref:${hash}`, hash, line: hash })
      if (shownCommits.has(hash)) {
        const line = model.runOf.get(hash)!
        list.push({ kind: 'commit', key: hash, hash, line })
        if (selectedMerge === hash && selectedHash !== null) {
          list.push({ kind: 'side', key: `side:${selectedHash}`, hash: selectedHash, line, mergeHash: hash })
        }
      }
      const more = moreAfter.get(hash)
      if (more !== undefined) list.push({ kind: 'more', key: `more:${more.line}`, ...more })
    }
    return { list, shownCommits }
  }, [model, isOpen, fullyShownRows, linesWithMatches, selectedHash, mergeOfSideCommit])

  const matchCount = searchQuery ? matchedHashes.size : null
  useEffect(() => {
    onStats?.({ laneCount: model.laneCount, refCount: model.rows.length, matchCount })
  }, [model.laneCount, model.rows.length, matchCount, onStats])

  // The inline commit detail, beneath the selected commit's row.
  const rowsContainerRef = useRef<HTMLDivElement>(null)
  const selectedIndex =
    selectedHash === null
      ? -1
      : items.list.findIndex((item) => (item.kind === 'commit' || item.kind === 'side') && item.hash === selectedHash)
  const detailAfterIndex = selectedDetail !== null ? selectedIndex : -1
  const detailRef = useRef<HTMLDivElement>(null)
  const [detailHeight, setDetailHeight] = useState(0)
  useLayoutEffect(() => {
    const node = detailRef.current
    if (detailAfterIndex < 0 || node === null) {
      setDetailHeight(0)
      return
    }
    const measure = () => setDetailHeight(node.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [detailAfterIndex])

  // Keep the selected row and the first match in view.
  const rowElement = (key: string) =>
    [...(rowsContainerRef.current?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [])].find(
      (element) => element.dataset.rowKey === key,
    )
  useEffect(() => {
    if (selectedIndex < 0 || selectedHash === null) return
    rowElement(items.list[selectedIndex]!.key)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex, selectedHash, items])
  const firstMatchKey = searchQuery
    ? items.list.find((item) => item.kind === 'commit' && matchedHashes.has(item.hash))?.key
    : undefined
  useEffect(() => {
    if (firstMatchKey === undefined) return
    rowElement(firstMatchKey)?.scrollIntoView?.({ block: 'center' })
  }, [searchQuery, firstMatchKey])

  // Geometry. Every row is ROW_HEIGHT tall; rows below the inline detail move
  // down by its measured height.
  const itemTop = (index: number) =>
    index * ROW_HEIGHT + (detailAfterIndex >= 0 && index > detailAfterIndex ? detailHeight : 0)
  const centreByKey = new Map<string, number>()
  items.list.forEach((item, index) => centreByKey.set(item.key, itemTop(index) + ROW_HEIGHT / 2))
  const bottom = items.list.length * ROW_HEIGHT + (detailAfterIndex >= 0 ? detailHeight : 0)
  const openEnd = bottom + OPEN_END_OVERHANG
  /** Where a commit sits: its own row, its ref row, or the boundary above the next row below it. */
  const yOf = (hash: string | null): number => {
    if (hash === null) return openEnd
    if (items.shownCommits.has(hash)) return centreByKey.get(hash)!
    if (model.lane.has(hash)) return centreByKey.get(`ref:${hash}`)!
    const position = model.position.get(hash)!
    const index = items.list.findIndex(
      (item) => (item.kind === 'ref' || item.kind === 'commit') && model.position.get(item.hash)! > position,
    )
    return index < 0 ? openEnd : itemTop(index)
  }
  const laneOfRow = (rowHash: string) => model.lane.get(rowHash) ?? 0

  const linePaths: { key: string; d: string; color: string }[] = []
  for (const rowHash of model.rows) {
    const lane = laneOfRow(rowHash)
    const x = laneX(lane)
    const nodeY = centreByKey.get(`ref:${rowHash}`)!
    const forkHash = model.fork.get(rowHash) ?? null
    const forkY = yOf(forkHash)
    const forkLane = forkHash !== null ? laneOfRow(model.runOf.get(forkHash)!) : lane
    let d: string
    if (forkLane === lane) {
      d = `M${x},${nodeY} L${x},${forkY}`
    } else {
      const bend = Math.min(BEND_HEIGHT, (forkY - nodeY) / 2)
      const forkX = laneX(forkLane)
      d = `M${x},${nodeY} L${x},${forkY - bend} C${x},${forkY - bend / 2} ${forkX},${forkY - bend / 2} ${forkX},${forkY}`
    }
    linePaths.push({ key: `line:${rowHash}`, d, color: laneColor(lane) })
    const mergeHash = model.merge.get(rowHash) ?? null
    if (mergeHash !== null) {
      const mergeY = yOf(mergeHash)
      const mergeX = laneX(laneOfRow(model.runOf.get(mergeHash) ?? rowHash))
      const bend = Math.min(BEND_HEIGHT, (nodeY - mergeY) / 2)
      linePaths.push({
        key: `merge:${rowHash}`,
        d: `M${mergeX},${mergeY} C${mergeX},${mergeY + bend / 2} ${x},${mergeY + bend / 2} ${x},${mergeY + bend} L${x},${nodeY}`,
        color: laneColor(lane),
      })
    }
  }

  const contentLeft = graphContentLeft(model.laneCount)
  const graphWidth = graphColumnWidth(model.laneCount)
  const nowTime = now ?? Date.now()

  function focusRow(key: string | undefined) {
    if (key !== undefined) rowElement(key)?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-row-key]')
    if (target === null) return
    const key = target.dataset.rowKey!
    const index = items.list.findIndex((item) => item.key === key)
    const item = items.list[index]
    if (item === undefined) return
    let handled = true
    if (event.key === 'ArrowDown') focusRow(items.list[index + 1]?.key)
    else if (event.key === 'ArrowUp') focusRow(items.list[index - 1]?.key)
    else if (event.key === 'ArrowRight' && item.kind === 'ref' && !isOpen(item.hash)) toggleRow(item.hash)
    else if (event.key === 'ArrowLeft' && item.kind === 'ref' && isOpen(item.hash)) toggleRow(item.hash)
    else if (event.key === 'ArrowLeft' && item.kind !== 'ref') focusRow(`ref:${item.line}`)
    else if (event.key === 'Escape' && onClearSelection) onClearSelection()
    else handled = false
    if (!handled) return
    // Handled keys stop here, so the host's own shortcuts never act on them too.
    event.preventDefault()
    event.stopPropagation()
  }

  // A row on an open line is tinted with its lane colour through `--line-tint`,
  // so the shared hover and selected tokens still win over it.
  const rowBaseClass =
    'flex w-full cursor-pointer items-center gap-2 bg-(--line-tint) pr-4 text-left whitespace-nowrap'
  const dimClass = 'opacity-25 hover:opacity-60'
  const tint = (lane: number, percent: number) =>
    ({ '--line-tint': `color-mix(in srgb, ${laneColor(lane)} ${percent}%, transparent)` }) as CSSProperties

  return (
    <div className="relative">
      <svg
        className="pointer-events-none absolute top-0 left-0 z-10"
        width={graphWidth}
        height={bottom + OPEN_END_OVERHANG + 2}
        aria-hidden="true"
        data-testid="branch-graph-svg"
      >
        {linePaths.map((path) => (
          <path key={path.key} d={path.d} fill="none" stroke={path.color} strokeWidth={LINE_WIDTH} />
        ))}
        {selectedIndex >= 0 && (
          <circle
            cx={laneX(laneOfRow(items.list[selectedIndex]!.line))}
            cy={centreByKey.get(items.list[selectedIndex]!.key)}
            r={NODE_RADIUS + 4}
            fill="none"
            stroke={laneColor(laneOfRow(items.list[selectedIndex]!.line))}
            strokeWidth={1.5}
            opacity={0.55}
          />
        )}
        {items.list.map((item) => {
          const lane = laneOfRow(item.line)
          const x = laneX(lane)
          const y = centreByKey.get(item.key)!
          const color = laneColor(lane)
          if (item.kind === 'ref') {
            return <circle key={item.key} data-ref-node={item.hash} cx={x} cy={y} r={REF_NODE_RADIUS} fill={color} />
          }
          if (item.kind === 'commit') {
            const isMerge = (commitByHash.get(item.hash)?.parents.length ?? 0) > 1
            return isMerge ? (
              <circle key={item.key} cx={x} cy={y} r={COMMIT_DOT_RADIUS} fill="var(--color-canvas)" stroke={color} strokeWidth={1.5} />
            ) : (
              <circle key={item.key} cx={x} cy={y} r={COMMIT_DOT_RADIUS} fill={color} />
            )
          }
          if (item.kind === 'more') {
            return (
              <g key={item.key}>
                <rect x={x - 5} y={y - 9} width={10} height={18} rx={5} fill="var(--color-canvas)" stroke={color} strokeWidth={LINE_WIDTH} />
                {[-4, 0, 4].map((offset) => (
                  <circle key={offset} cx={x} cy={y + offset} r={1.15} fill={color} />
                ))}
              </g>
            )
          }
          // A merged-in side commit lies on no line, so it gets no dot.
          return null
        })}
      </svg>

      <div ref={rowsContainerRef} className="relative" onKeyDown={handleKeyDown}>
        {items.list.map((item, index) => {
          const lane = laneOfRow(item.line)
          const rowStyle = { height: ROW_HEIGHT, paddingLeft: contentLeft }
          let row: ReactNode

          if (item.kind === 'ref') {
            const commit = commitByHash.get(item.hash)!
            const open = isOpen(item.hash)
            const runLength = model.run.get(item.hash)!.length
            const hits = searchQuery ? model.run.get(item.hash)!.filter((hash) => matchedHashes.has(hash)).length : 0
            const lineLeft = lineLeftBy(model, item.hash, (hash) => commitByHash.get(hash)?.refs ?? [], remotes, defaultBranch)
            const commitsText = `${runLength} commit${runLength === 1 ? '' : 's'}`
            row = (
              <button
                type="button"
                data-row-key={item.key}
                data-row-kind="ref"
                aria-expanded={open}
                title={`${open ? 'Hide' : 'Show'} the ${commitsText} on this line`}
                className={`${rowBaseClass} hover:bg-rowhover ${searchQuery && hits === 0 ? dimClass : ''}`}
                style={{ ...rowStyle, ...(open ? tint(lane, 13) : NO_TINT) }}
                onClick={() => toggleRow(item.hash)}
              >
                <IconChevronRight
                  size={14}
                  aria-hidden
                  className={`shrink-0 text-dim transition-transform ${open ? 'rotate-90' : ''}`}
                />
                <CommitRefRow groups={refGroupsOf(item.hash)} laneColor={laneColor(lane)} />
                <span className="shrink-0 font-mono text-[11.5px] text-dim" data-testid="line-count">
                  {hits > 0 ? `${hits} of ${commitsText}` : commitsText}
                </span>
                <span className="min-w-0 flex-1" />
                <span className="shrink-0 truncate font-mono text-[11.5px] text-faint">
                  {lineLeft !== null && (
                    <>
                      <span className="text-dim" data-testid="line-left">
                        from {lineLeft}
                      </span>
                      <span className="mx-1.5 opacity-40">·</span>
                    </>
                  )}
                  {commit.author}
                  <span className="mx-1.5 opacity-40">·</span>
                  <span title={commit.date}>{relativeAge(commit.date, nowTime)}</span>
                </span>
              </button>
            )
          } else if (item.kind === 'more') {
            row = (
              <button
                type="button"
                data-row-key={item.key}
                data-row-kind="more"
                className={`${rowBaseClass} text-accent hover:bg-rowhover`}
                style={{ ...rowStyle, ...tint(lane, 7) }}
                onClick={() => setFullyShownRows((current) => addTo(current, item.line))}
              >
                <IconChevronsDown size={14} aria-hidden className="shrink-0" />
                <span className="font-mono text-[11.5px]">
                  show {item.hidden} more commit{item.hidden === 1 ? '' : 's'}
                </span>
              </button>
            )
          } else {
            const commit = commitByHash.get(item.hash)!
            const isSelected = commit.hash === selectedHash
            const subject = fuzzyHighlight(commit.subject, searchQuery)
            const hash = fuzzyHighlight(commit.hash, searchQuery)
            const author = fuzzyHighlight(commit.author, searchQuery)
            const matched = matchedHashes.has(commit.hash)
            // The tip's refs are on the ref row already.
            const groups = item.kind === 'commit' && commit.hash === item.line ? [] : refGroupsOf(commit.hash)
            const sideCount = item.kind === 'commit' ? (model.mergedBy.get(commit.hash)?.length ?? 0) : 0
            row = (
              <button
                type="button"
                data-row-key={item.key}
                data-row-kind={item.kind}
                aria-current={isSelected ? 'true' : undefined}
                className={`${rowBaseClass} hover:bg-rowhover ${
                  searchQuery && !matched ? dimClass : ''
                }`}
                style={{ ...rowStyle, ...(isSelected ? SELECTED_TINT : tint(lane, 7)) }}
                onClick={() => onSelectCommit?.(commit)}
              >
                <CommitRefRow groups={groups} laneColor={laneColor(lane)} />
                <span className="min-w-0 flex-1 truncate">
                  <FuzzySegments highlight={subject} />
                </span>
                {sideCount > 0 && (
                  <span
                    className="shrink-0 rounded border border-line px-1.5 font-mono text-[11px] text-dim"
                    title={`This merge brought in ${sideCount} commit${sideCount === 1 ? '' : 's'} that lie on no ref's line, such as a branch deleted after the merge. The Commits view draws them.`}
                  >
                    +{sideCount} merged
                  </span>
                )}
                {item.kind === 'side' && (
                  <span
                    className="shrink-0 rounded border border-line px-1.5 font-mono text-[11px] text-dim"
                    title={`This commit lies on no ref's line; merge ${item.mergeHash} brought it in. The Commits view draws it in place.`}
                  >
                    merged by {item.mergeHash}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[11.5px] text-faint">
                  <span className="text-dim">
                    <FuzzySegments highlight={hash} />
                  </span>
                  <span className="mx-1.5 opacity-40">·</span>
                  <FuzzySegments highlight={author} />
                  <span className="mx-1.5 opacity-40">·</span>
                  {commit.date}
                </span>
              </button>
            )
          }

          return (
            <div key={item.key}>
              {row}
              {index === detailAfterIndex && (
                <div ref={detailRef} style={{ paddingLeft: graphWidth }}>
                  {selectedDetail}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
