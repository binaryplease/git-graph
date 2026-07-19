// LAYOUT — lane (column) assignment for a commit DAG.
//
// Verbatim port of the algorithm proven in the mission-control-center
// prototype (git-graph/index.html, commit 9f74265): pvigier's active-lane
// sweep, the approach used by mhutchie/vscode-git-graph, GitLens and
// GitKraken. Reference:
// https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html
//
// Input MUST be in topological order (every commit appears above all of its
// parents), which `git log --topo-order` guarantees.
//
// We sweep top-to-bottom maintaining `activeLanes`: for each column, the hash
// of the commit that column is currently waiting to reach (or null when free).
//
//   - A commit takes the leftmost lane already waiting for it; any other lanes
//     waiting for the same hash collapse into it (that's a merge target).
//   - A commit nobody is waiting for (a branch tip) claims a free lane.
//   - Its first parent continues in the commit's own lane; extra parents open
//     new lanes (reusing freed ones). A parent already awaited by some lane
//     just reuses that lane — which is how two branches visually merge into
//     one.

/** The minimal commit shape the layout needs — hash identity plus parent links. */
export type GraphCommitInput = {
  hash: string
  parents: string[]
}

export type CommitPlacement = {
  /** Column (0-based, left to right) the commit's node sits in. */
  lane: number
}

/** One child→parent edge, with enough geometry to draw it. */
export type GraphLink = {
  childRow: number
  childLane: number
  parentRow: number
  parentLane: number
}

export type GraphLayout = {
  /** Per-commit placement, indexed like the input array (row order). */
  placements: CommitPlacement[]
  links: GraphLink[]
  /** Total number of columns the graph occupies. */
  laneCount: number
}

export function computeGraphLayout(commits: readonly GraphCommitInput[]): GraphLayout {
  const rowByHash = new Map<string, number>()
  commits.forEach((commit, row) => rowByHash.set(commit.hash, row))

  const activeLanes: Array<string | null> = [] // activeLanes[lane] = awaited hash, or null when free
  const placements = new Array<CommitPlacement>(commits.length)
  const links: GraphLink[] = []
  let laneCount = 0

  const claimFreeLane = (): number => {
    for (let laneIndex = 0; laneIndex < activeLanes.length; laneIndex++) {
      if (activeLanes[laneIndex] === null) return laneIndex
    }
    activeLanes.push(null)
    return activeLanes.length - 1
  }

  commits.forEach((commit, row) => {
    // Which lane(s) were waiting for this commit?
    let commitLane = -1
    for (let laneIndex = 0; laneIndex < activeLanes.length; laneIndex++) {
      if (activeLanes[laneIndex] === commit.hash) {
        if (commitLane === -1) {
          commitLane = laneIndex
        } else {
          activeLanes[laneIndex] = null // extra waiter collapses into commitLane
        }
      }
    }
    if (commitLane === -1) commitLane = claimFreeLane() // branch tip
    activeLanes[commitLane] = null // the commit has "arrived"; free its slot

    placements[row] = { lane: commitLane }
    laneCount = Math.max(laneCount, commitLane + 1)

    // Parents outside the visible window (truncated or shallow history) are
    // ignored — no lane is reserved and no edge is drawn for them.
    const visibleParents = commit.parents.filter((parentHash) => rowByHash.has(parentHash))
    visibleParents.forEach((parentHash, parentOrdinal) => {
      let parentLane = activeLanes.indexOf(parentHash)
      if (parentLane === -1) {
        parentLane = parentOrdinal === 0 ? commitLane : claimFreeLane()
        activeLanes[parentLane] = parentHash
      }
      laneCount = Math.max(laneCount, parentLane + 1)
      links.push({
        childRow: row,
        childLane: commitLane,
        parentRow: rowByHash.get(parentHash)!,
        parentLane,
      })
    })
  })

  return { placements, links, laneCount }
}
