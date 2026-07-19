import { describe, expect, test } from 'bun:test'
import { computeGraphLayout, type GraphCommitInput } from './graphLayout'

// Helper: input rows are in topological order (children before parents),
// exactly what `git log --topo-order` emits.
const commit = (hash: string, ...parents: string[]): GraphCommitInput => ({ hash, parents })

const lanesOf = (commits: GraphCommitInput[]) =>
  computeGraphLayout(commits).placements.map((placement) => placement.lane)

describe('computeGraphLayout — topology cases', () => {
  test('linear chain down to a root commit stays in lane 0', () => {
    const commits = [commit('c2', 'c1'), commit('c1', 'c0'), commit('c0')]
    const layout = computeGraphLayout(commits)
    expect(layout.placements.map((placement) => placement.lane)).toEqual([0, 0, 0])
    expect(layout.laneCount).toBe(1)
    expect(layout.links).toEqual([
      { childRow: 0, childLane: 0, parentRow: 1, parentLane: 0 },
      { childRow: 1, childLane: 0, parentRow: 2, parentLane: 0 },
    ])
  })

  test('root commit produces no links', () => {
    const layout = computeGraphLayout([commit('root')])
    expect(layout.placements).toEqual([{ lane: 0 }])
    expect(layout.links).toEqual([])
    expect(layout.laneCount).toBe(1)
  })

  test('a second branch tip claims its own lane and rejoins its parent lane', () => {
    // m2 and f1 are both children of m1: f1 is an unmerged branch tip.
    const commits = [commit('m2', 'm1'), commit('f1', 'm1'), commit('m1', 'm0'), commit('m0')]
    const layout = computeGraphLayout(commits)
    expect(layout.placements.map((placement) => placement.lane)).toEqual([0, 1, 0, 0])
    expect(layout.laneCount).toBe(2)
    // f1's edge leaves lane 1 and lands on m1 in lane 0 — the visual join.
    expect(layout.links).toContainEqual({ childRow: 1, childLane: 1, parentRow: 2, parentLane: 0 })
  })

  test('two-parent merge: second parent opens a new lane, branch rejoins at the fork point', () => {
    // m3 merges branch f1 (forked from m1) back into main.
    const commits = [
      commit('m3', 'm2', 'f1'),
      commit('m2', 'm1'),
      commit('f1', 'm1'),
      commit('m1', 'm0'),
      commit('m0'),
    ]
    const layout = computeGraphLayout(commits)
    expect(layout.placements.map((placement) => placement.lane)).toEqual([0, 0, 1, 0, 0])
    expect(layout.laneCount).toBe(2)
    expect(layout.links).toEqual([
      { childRow: 0, childLane: 0, parentRow: 1, parentLane: 0 }, // merge → first parent, same lane
      { childRow: 0, childLane: 0, parentRow: 2, parentLane: 1 }, // merge → second parent, new lane
      { childRow: 1, childLane: 0, parentRow: 3, parentLane: 0 },
      { childRow: 2, childLane: 1, parentRow: 3, parentLane: 0 }, // branch rejoins main's lane at the fork
      { childRow: 3, childLane: 0, parentRow: 4, parentLane: 0 },
    ])
  })

  test('a lane freed by a closed branch is reused by the next branch', () => {
    // Same merged-branch shape as above, plus an older unmerged tip g1 that
    // only appears after f1's lane (1) has been freed — it must reuse lane 1,
    // not open lane 2.
    const commits = [
      commit('m3', 'm2', 'f1'),
      commit('m2', 'm1'),
      commit('f1', 'm1'), // lane 1 frees here (f1's parent continues in lane 0)
      commit('m1', 'm0'),
      commit('g1', 'm0'), // new tip — reuses freed lane 1
      commit('m0'),
    ]
    const layout = computeGraphLayout(commits)
    expect(layout.placements.map((placement) => placement.lane)).toEqual([0, 0, 1, 0, 1, 0])
    expect(layout.laneCount).toBe(2)
  })

  test('octopus merge (3 parents) opens a lane per extra parent', () => {
    const commits = [
      commit('octo', 'p1', 'p2', 'p3'),
      commit('p1', 'root'),
      commit('p2', 'root'),
      commit('p3', 'root'),
      commit('root'),
    ]
    const layout = computeGraphLayout(commits)
    expect(layout.placements.map((placement) => placement.lane)).toEqual([0, 0, 1, 2, 0])
    expect(layout.laneCount).toBe(3)
    // The merge fans out to all three parents…
    expect(layout.links).toContainEqual({ childRow: 0, childLane: 0, parentRow: 1, parentLane: 0 })
    expect(layout.links).toContainEqual({ childRow: 0, childLane: 0, parentRow: 2, parentLane: 1 })
    expect(layout.links).toContainEqual({ childRow: 0, childLane: 0, parentRow: 3, parentLane: 2 })
    // …and every parent chain converges on the shared root in lane 0.
    expect(layout.links).toContainEqual({ childRow: 2, childLane: 1, parentRow: 4, parentLane: 0 })
    expect(layout.links).toContainEqual({ childRow: 3, childLane: 2, parentRow: 4, parentLane: 0 })
  })

  test('disconnected histories (multiple roots) keep separate lanes', () => {
    const commits = [commit('a1', 'a0'), commit('b1', 'b0'), commit('a0'), commit('b0')]
    const layout = computeGraphLayout(commits)
    expect(layout.placements.map((placement) => placement.lane)).toEqual([0, 1, 0, 1])
    expect(layout.laneCount).toBe(2)
  })

  test('parents outside the visible window are ignored (truncated / shallow history)', () => {
    const commits = [commit('c1', 'missing'), commit('c0', 'also-missing')]
    const layout = computeGraphLayout(commits)
    expect(layout.placements.map((placement) => placement.lane)).toEqual([0, 0])
    expect(layout.links).toEqual([])
    // c1's lane frees when it arrives, so c0 reuses lane 0.
    expect(layout.laneCount).toBe(1)
  })

  test('empty input yields an empty layout', () => {
    expect(computeGraphLayout([])).toEqual({ placements: [], links: [], laneCount: 0 })
  })
})

describe('computeGraphLayout — prototype regression fixture', () => {
  // The branch-heavy demo history from the prototype
  // (mission-control-center/git-graph/index.html @ 9f74265): two feature
  // branches and a hotfix, each merged back into main. The expected lanes were
  // captured by running the prototype's computeLayout() on this exact input —
  // this pins the port to the verified-in-browser behaviour.
  const demoHistory: GraphCommitInput[] = [
    commit('m10', 'm9', 'f3'),
    commit('f3', 'f2'),
    commit('m9', 'm8'),
    commit('f2', 'f1'),
    commit('m8', 'm7', 'g2'),
    commit('g2', 'g1'),
    commit('m7', 'm6'),
    commit('f1', 'm6'),
    commit('g1', 'm5'),
    commit('m6', 'm5'),
    commit('m5', 'm4'),
    commit('m4', 'm3', 'h1'),
    commit('h1', 'm2'),
    commit('m3', 'm2'),
    commit('m2', 'm1'),
    commit('m1', 'm0'),
    commit('m0'),
  ]

  test('lane assignment matches the prototype exactly', () => {
    const layout = computeGraphLayout(demoHistory)
    expect(layout.placements.map((placement) => placement.lane)).toEqual([
      0, 1, 0, 1, 0, 2, 0, 1, 2, 0, 2, 2, 0, 2, 0, 0, 0,
    ])
    expect(layout.laneCount).toBe(3)
    expect(layout.links).toHaveLength(19)
  })
})
