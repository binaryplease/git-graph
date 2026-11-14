import { describe, expect, test } from 'bun:test'
import {
  assignLineOwners,
  attributeMergedCommits,
  buildBranchTree,
  computeBranchTree,
  findDefaultTip,
  lineLeftBy,
  refRowSet,
  type BranchTreeCommit,
  type BranchTreeModel,
} from './branchTree'

// The Branches view model (variant A2). The fixture is a small version of the
// `ledgerline` repository the concept was measured on, built so each rule has a
// commit that exercises it:
//
//   m1 main (checked out, in sync with origin) ── m2 ── m3 upstream/main ── m4 ── m5 tag v1.0 (root)
//   x1 feature/x over x2 origin/feature/x, forked from m2      (a chain off the default line)
//   t1 tag v0.9-hotfix on top of m3, nothing above it            (a tag-only tip)
//   g1 ── g2 feature/merged, forked from m4, merged into main by m2
//   r1 ── r2 ── r3 ── r4 spike/pdf-renderer, forked from m4
//   f1 spike/pdf-fonts, forked from r3                           (a branch off a branch)
//   d1 ── d2 a deleted branch forked from m5, merged by m4       (side commits, "+2 merged")
//
// Listed children before parents, as `git log --topo-order` prints them.

const commit = (hash: string, parents: string[], refs: string[] = []): BranchTreeCommit => ({ hash, parents, refs })

const COMMITS: BranchTreeCommit[] = [
  commit('m1', ['m2'], ['HEAD -> main', 'origin/main']),
  commit('x1', ['x2'], ['feature/x']),
  commit('x2', ['m2'], ['origin/feature/x']),
  commit('t1', ['m3'], ['tag: v0.9-hotfix']),
  commit('m2', ['m3', 'g1']),
  commit('g1', ['g2'], ['feature/merged']),
  commit('g2', ['m4']),
  commit('m3', ['m4'], ['upstream/main']),
  commit('f1', ['r3'], ['spike/pdf-fonts']),
  commit('r1', ['r2'], ['spike/pdf-renderer']),
  commit('r2', ['r3']),
  commit('r3', ['r4']),
  commit('r4', ['m4']),
  commit('m4', ['m5', 'd1']),
  commit('d1', ['d2']),
  commit('d2', ['m5']),
  commit('m5', [], ['tag: v1.0']),
]
const REMOTES = ['origin', 'upstream']

const model = (tagsAreRows = false, commits = COMMITS, defaultBranch: string | null = 'main') =>
  computeBranchTree({ commits, remotes: REMOTES, defaultBranch, tagsAreRows })

const refsOf = (hash: string) => COMMITS.find((entry) => entry.hash === hash)?.refs ?? []

/** The invariants every model must hold, whatever the history. */
function expectInvariants(tree: BranchTreeModel, commits: readonly BranchTreeCommit[]) {
  // Topological: every commit above each of its parents.
  for (const entry of commits) {
    for (const parentHash of entry.parents) {
      if (!tree.position.has(parentHash)) continue
      expect(tree.position.get(entry.hash)!).toBeLessThan(tree.position.get(parentHash)!)
    }
  }
  // No commit on two lines.
  const lineCommits = [...tree.run.values()].flat()
  expect(new Set(lineCommits).size).toBe(lineCommits.length)
  // Lines plus merged-in side commits cover the window exactly once.
  const sideCommits = [...tree.mergedBy.values()].flat()
  expect(lineCommits.length + sideCommits.length).toBe(commits.length)
  expect(new Set([...lineCommits, ...sideCommits])).toEqual(new Set(commits.map((entry) => entry.hash)))
  // Every ref row has a lane.
  for (const rowHash of tree.rows) expect(tree.lane.has(rowHash)).toBe(true)
}

describe('refRowSet — which commits get a ref row', () => {
  test('branches, remote-tracking refs and HEAD always do; a tag-only commit with descendants does not', () => {
    expect(refRowSet(COMMITS, REMOTES, false)).toEqual(new Set(['m1', 'x1', 'x2', 't1', 'g1', 'm3', 'f1', 'r1']))
  })

  test('with tags as rows, the tag-only commit with descendants gets a row too', () => {
    expect(refRowSet(COMMITS, REMOTES, true)).toEqual(
      new Set(['m1', 'x1', 'x2', 't1', 'g1', 'm3', 'f1', 'r1', 'm5']),
    )
  })

  test('a tag-only commit nothing in the window descends from gets a row either way', () => {
    expect(refRowSet(COMMITS, REMOTES, false).has('t1')).toBe(true)
    expect(refRowSet(COMMITS, REMOTES, true).has('t1')).toBe(true)
  })

  test('an undecorated commit nothing descends from still gets a row, so its commits sit under one', () => {
    const commits = [commit('a1', ['a2']), commit('b1', ['a2'], ['main']), commit('a2', [])]
    expect(refRowSet(commits, [], false)).toEqual(new Set(['a1', 'b1']))
  })
})

describe('findDefaultTip', () => {
  test('finds the local default branch, checked out or not', () => {
    expect(findDefaultTip(COMMITS, REMOTES, 'main')).toBe('m1')
    expect(findDefaultTip([commit('a', [], ['main'])], [], 'main')).toBe('a')
  })

  test('never guesses at an origin/ prefix', () => {
    // Only the remote-tracking ref is in the window: no local default tip.
    expect(findDefaultTip([commit('a', [], ['origin/main'])], ['origin'], 'main')).toBeNull()
    // With no remotes, `origin/main` is a local branch of that name, not `main`.
    expect(findDefaultTip([commit('a', [], ['origin/main'])], [], 'main')).toBeNull()
  })

  test('an unknown default branch has no tip', () => {
    expect(findDefaultTip(COMMITS, REMOTES, null)).toBeNull()
  })
})

describe('assignLineOwners — the line rule', () => {
  const owners = assignLineOwners(COMMITS, refRowSet(COMMITS, REMOTES, false), 'm1')

  test('each row on the default line owns the commits down to the next row', () => {
    expect(owners.get('m1')).toBe('m1')
    expect(owners.get('m2')).toBe('m1')
    expect(owners.get('m3')).toBe('m3')
    expect(owners.get('m4')).toBe('m3')
    expect(owners.get('m5')).toBe('m3')
  })

  test('the other rows claim their first-parent commits, the longest run first', () => {
    // spike/pdf-renderer's run (r1–r4) is longer than spike/pdf-fonts' (f1, r3, r4),
    // so the renderer keeps the shared stem and the fonts branch keeps f1 alone.
    expect(['r1', 'r2', 'r3', 'r4'].map((hash) => owners.get(hash))).toEqual(['r1', 'r1', 'r1', 'r1'])
    expect(owners.get('f1')).toBe('f1')
  })

  test('side commits of a merge belong to no line', () => {
    expect(owners.has('d1')).toBe(false)
    expect(owners.has('d2')).toBe(false)
  })
})

describe('computeBranchTree — the tree of lines', () => {
  test('holds the invariants in both tag modes', () => {
    expectInvariants(model(false), COMMITS)
    expectInvariants(model(true), COMMITS)
  })

  test('the row order is topological, the default line first, each branch directly above its fork', () => {
    const tree = model()
    expect(tree.rows).toEqual(['m1', 'x1', 'x2', 't1', 'm3', 'g1', 'r1', 'f1'])
    // spike/pdf-renderer sits above m4, where it leaves main, and the branch
    // forked from it sits below it.
    expect(tree.position.get('r1')!).toBeLessThan(tree.position.get('m4')!)
    expect(tree.position.get('f1')!).toBeGreaterThan(tree.position.get('r1')!)
  })

  test("lane 0 is the default branch's line", () => {
    const tree = model()
    expect(tree.lane.get('m1')).toBe(0)
    expect(tree.defaultLine.has('m1')).toBe(true)
    for (const rowHash of tree.rows) {
      if (!tree.defaultLine.has(rowHash)) expect(tree.lane.get(rowHash)!).toBeGreaterThan(0)
    }
  })

  test('a branch forked from a feature branch forks from that branch, not from the default line', () => {
    const tree = model()
    expect(tree.fork.get('f1')).toBe('r3')
    expect(tree.runOf.get('r3')).toBe('r1')
    expect(tree.lane.get('f1')!).toBeGreaterThan(tree.lane.get('r1')!)
    expect(lineLeftBy(tree, 'f1', refsOf, REMOTES, 'main')).toBe('spike/pdf-renderer')
    expect(lineLeftBy(tree, 'r1', refsOf, REMOTES, 'main')).toBe('main')
  })

  test("a ref whose fork is another ref's tip continues that ref's lane", () => {
    const tree = model()
    // main over upstream/main, and feature/x over origin/feature/x.
    expect(tree.fork.get('m1')).toBe('m3')
    expect(tree.lane.get('m3')).toBe(tree.lane.get('m1'))
    expect(tree.defaultLine).toEqual(new Set(['m1', 'm3']))
    expect(tree.fork.get('x1')).toBe('x2')
    expect(tree.lane.get('x1')).toBe(tree.lane.get('x2'))
    // A continuation names no line it leaves; the ref it continues does.
    expect(lineLeftBy(tree, 'x1', refsOf, REMOTES, 'main')).toBeNull()
    expect(lineLeftBy(tree, 'x2', refsOf, REMOTES, 'main')).toBe('main')
    // A tip continues one ref only: the tag on top of upstream/main takes a lane of its own.
    expect(tree.lane.get('t1')).not.toBe(tree.lane.get('m3'))
  })

  test('the default line names nothing it leaves', () => {
    const tree = model()
    expect(lineLeftBy(tree, 'm1', refsOf, REMOTES, 'main')).toBeNull()
    expect(lineLeftBy(tree, 'm3', refsOf, REMOTES, 'main')).toBeNull()
  })

  test('a merged ref has the merge that took its tip recorded', () => {
    const tree = model()
    expect(tree.merge.get('g1')).toBe('m2')
    expect(tree.merge.get('r1')).toBeNull()
    // Its lane is held from the merge down, so nothing else is drawn across it.
    expect(tree.lane.get('g1')).not.toBe(tree.lane.get('x1'))
  })

  test('a side branch whose ref was deleted is counted on the merge that brought it in', () => {
    const tree = model()
    expect([...(tree.mergedBy.get('m4') ?? [])].sort()).toEqual(['d1', 'd2'])
    // The merge of a branch that still has its ref brings in nothing uncounted.
    expect(tree.mergedBy.has('m2')).toBe(false)
  })

  test('a side commit merged twice is counted once, on the earlier merge', () => {
    // s1–s2 merged by a3, then s0 on top of them merged again by a1.
    const commits = [
      commit('a1', ['a2', 's0'], ['main']),
      commit('a2', ['a3']),
      commit('s0', ['s1']),
      commit('a3', ['a4', 's1']),
      commit('s1', ['s2']),
      commit('s2', ['a4']),
      commit('a4', []),
    ]
    const tree = computeBranchTree({ commits, remotes: [], defaultBranch: 'main', tagsAreRows: false })
    expect([...tree.mergedBy.get('a3')!].sort()).toEqual(['s1', 's2'])
    expect(tree.mergedBy.get('a1')).toEqual(['s0'])
    expectInvariants(tree, commits)
  })

  test('the lanes of the fixture, pinned', () => {
    // The model takes no open-row input, so these are the lanes whatever is open;
    // BranchGraph.test.tsx checks that opening rows leaves the ref nodes in place.
    expect(Object.fromEntries(model().lane)).toEqual({ m1: 0, m3: 0, x1: 1, x2: 1, t1: 1, g1: 2, r1: 1, f1: 3 })
    expect(model().laneCount).toBe(4)
  })

  test("a feature merging the default branch's tip leaves the default line whole", () => {
    // main (m2) on upstream/main (m1) on m0; feature f2 merges m2 into f1.
    const commits = [
      commit('f2', ['f1', 'm2'], ['feature']),
      commit('m2', ['m1'], ['main']),
      commit('m1', ['m0'], ['upstream/main']),
      commit('f1', ['m0']),
      commit('m0', []),
    ]
    const tree = computeBranchTree({ commits, remotes: ['upstream'], defaultBranch: 'main', tagsAreRows: false })
    // Merges of main into a feature are not drawn …
    expect(tree.merge.get('m2')).toBeNull()
    // … and main still continues over upstream/main in lane 0.
    expect(tree.lane.get('m2')).toBe(0)
    expect(tree.lane.get('m1')).toBe(0)
    expect(tree.defaultLine).toEqual(new Set(['m2', 'm1']))
    expect(tree.lane.get('f2')).toBe(1)
    expectInvariants(tree, commits)
  })

  test('tags as rows: the tag-only commit becomes a row on the default line and takes its commits', () => {
    const tree = model(true)
    expect(tree.rows).toContain('m5')
    expect(tree.run.get('m5')).toEqual(['m5'])
    expect(tree.run.get('m3')).toEqual(['m3', 'm4'])
    expect(tree.lane.get('m5')).toBe(0)
  })

  test('with no default tip in the window there is no default line, and every row still gets a lane', () => {
    const tree = model(false, COMMITS, null)
    expect(tree.defaultTip).toBeNull()
    expect(tree.defaultLine.size).toBe(0)
    expectInvariants(tree, COMMITS)
    expect(lineLeftBy(tree, 'r1', refsOf, REMOTES, null)).not.toBe('main')
  })

  test('buildBranchTree and attributeMergedCommits compose to the same model', () => {
    const rows = refRowSet(COMMITS, REMOTES, false)
    const tree = buildBranchTree(COMMITS, rows, assignLineOwners(COMMITS, rows, 'm1'), 'm1')
    expect(tree.rows).toEqual(model().rows)
    expect(attributeMergedCommits(COMMITS, tree)).toEqual(model().mergedBy)
  })
})
