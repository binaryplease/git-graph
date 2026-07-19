import { useEffect, useMemo, useRef } from 'react'
import type { GitCommit } from '../../shared/git.schema'
import { computeGraphLayout } from '../../shared/graphLayout'
import { fuzzyHighlight, type FuzzyHighlight } from '../../shared/fuzzy'

// The reusable commit-graph view: commits in, SVG + rows out. It owns no data
// fetching and no app chrome, so it can be lifted into another host
// (nightshift-ui) as-is. Rendering geometry and behaviour are the parity port
// of the mission-control-center prototype (git-graph/index.html @ 9f74265).

export const ROW_HEIGHT = 28
const LANE_GAP = 16
const X_OFFSET = 16
const NODE_RADIUS = 5

// Distinct lane hues that read well on the dark background.
const LANE_COLORS = [
  '#58a6ff', '#7ee787', '#e3b341', '#ff7b72', '#d2a8ff',
  '#79c0ff', '#56d364', '#f0883e', '#ff9bce', '#a5d6ff',
]
const laneColor = (laneIndex: number) => LANE_COLORS[laneIndex % LANE_COLORS.length]!

const laneX = (lane: number) => X_OFFSET + lane * LANE_GAP
const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2

// Curve from a child node down to a parent node. When lanes differ, complete
// the horizontal shift inside the first row (a smooth elbow) then run straight
// down the parent's lane — so long edges never diagonally cross other columns.
function edgePath(childLane: number, childRow: number, parentLane: number, parentRow: number) {
  const startX = laneX(childLane)
  const startY = rowY(childRow)
  const endX = laneX(parentLane)
  const endY = rowY(parentRow)
  if (childLane === parentLane) return `M${startX},${startY} L${endX},${endY}`
  const dip = Math.min(ROW_HEIGHT, endY - startY)
  const elbowY = startY + dip
  let path = `M${startX},${startY} C${startX},${startY + dip * 0.5} ${endX},${startY + dip * 0.5} ${endX},${elbowY}`
  if (elbowY < endY) path += ` L${endX},${endY}`
  return path
}

type RefKind = 'head' | 'branch' | 'remote' | 'tag'

function classifyRef(ref: string): RefKind {
  if (ref.startsWith('HEAD')) return 'head'
  if (ref.startsWith('tag:')) return 'tag'
  if (ref.startsWith('origin/') || ref.startsWith('remotes/')) return 'remote'
  return 'branch'
}

const refDisplayLabel = (ref: string) => (ref.startsWith('tag:') ? ref.replace(/^tag:\s*/, '') : ref)

/** Matched-character highlighting (ADR-0019): matched runs render as <mark>. */
function FuzzySegments({ highlight }: { highlight: FuzzyHighlight }) {
  return (
    <>
      {highlight.segments.map((segment, segmentIndex) =>
        segment.matched ? (
          <mark key={segmentIndex}>{segment.text}</mark>
        ) : (
          <span key={segmentIndex}>{segment.text}</span>
        ),
      )}
    </>
  )
}

export type CommitGraphStats = {
  laneCount: number
  /** Number of rows matching the search query; null when there is no query. */
  matchCount: number | null
}

export type CommitGraphProps = {
  /** Commits in topological order (children before all of their parents). */
  commits: GitCommit[]
  /** Fuzzy search query; matching rows highlight, the rest dim. */
  searchQuery?: string
  /** Reports derived numbers for host chrome (readouts). Pass a stable callback. */
  onStats?: (stats: CommitGraphStats) => void
}

export function CommitGraph({ commits, searchQuery = '', onStats }: CommitGraphProps) {
  const layout = useMemo(() => computeGraphLayout(commits), [commits])
  const visibleHashes = useMemo(() => new Set(commits.map((commit) => commit.hash)), [commits])

  const rows = useMemo(
    () =>
      commits.map((commit) => {
        const subject = fuzzyHighlight(commit.subject, searchQuery)
        const hash = fuzzyHighlight(commit.hash, searchQuery)
        const author = fuzzyHighlight(commit.author, searchQuery)
        return {
          commit,
          subject,
          hash,
          author,
          matched: subject.matched || hash.matched || author.matched,
        }
      }),
    [commits, searchQuery],
  )

  const matchCount = searchQuery
    ? rows.reduce((count, row) => count + (row.matched ? 1 : 0), 0)
    : null

  useEffect(() => {
    onStats?.({ laneCount: layout.laneCount, matchCount })
  }, [layout.laneCount, matchCount, onStats])

  // Bring the first match into view when the query changes.
  const rowsContainerRef = useRef<HTMLDivElement>(null)
  const firstMatchRow = searchQuery ? rows.findIndex((row) => row.matched) : -1
  useEffect(() => {
    if (firstMatchRow < 0) return
    rowsContainerRef.current?.children[firstMatchRow]?.scrollIntoView({ block: 'center' })
  }, [searchQuery, firstMatchRow])

  const graphWidth = X_OFFSET * 2 + Math.max(0, layout.laneCount - 1) * LANE_GAP
  const totalHeight = commits.length * ROW_HEIGHT

  return (
    <div className="relative">
      <svg
        className="pointer-events-none absolute top-0 left-0"
        width={graphWidth}
        height={totalHeight}
        aria-hidden="true"
      >
        {layout.links.map((link, linkIndex) => (
          <path
            key={linkIndex}
            d={edgePath(link.childLane, link.childRow, link.parentLane, link.parentRow)}
            fill="none"
            stroke={laneColor(link.parentLane)}
            strokeWidth={2}
          />
        ))}
        {commits.map((commit, row) => {
          const lane = layout.placements[row]!.lane
          const isMerge =
            commit.parents.filter((parentHash) => visibleHashes.has(parentHash)).length > 1
          return (
            <circle
              key={commit.hash}
              cx={laneX(lane)}
              cy={rowY(row)}
              r={NODE_RADIUS}
              fill={isMerge ? 'var(--color-canvas)' : laneColor(lane)}
              stroke={isMerge ? laneColor(lane) : 'var(--color-canvas)'}
              strokeWidth={isMerge ? 2 : 1.5}
            />
          )
        })}
      </svg>

      <div ref={rowsContainerRef} className="relative">
        {rows.map(({ commit, subject, hash, author, matched }, row) => (
          <div
            key={`${commit.hash}-${row}`}
            className={`flex items-center gap-2 pr-4 whitespace-nowrap hover:bg-rowhover ${
              searchQuery && !matched ? 'opacity-25 hover:opacity-60' : ''
            }`}
            style={{ height: ROW_HEIGHT, paddingLeft: graphWidth + 8 }}
          >
            {commit.refs.length > 0 && (
              <span className="inline-flex shrink-0 gap-1.5">
                {commit.refs.map((ref) => (
                  <span key={ref} className={`ref-pill ref-${classifyRef(ref)}`}>
                    {refDisplayLabel(ref)}
                  </span>
                ))}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">
              <FuzzySegments highlight={subject} />
            </span>
            <span className="shrink-0 font-mono text-[11.5px] text-faint">
              <span className="text-dim">
                <FuzzySegments highlight={hash} />
              </span>
              <span className="mx-1.5 opacity-40">·</span>
              <FuzzySegments highlight={author} />
              <span className="mx-1.5 opacity-40">·</span>
              {commit.date}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
