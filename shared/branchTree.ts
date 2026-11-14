import type { GitCommit } from './git.schema'
import { classifyRefDecoration, groupRefDecorations, refGroupLabel } from './refGroup'

// The Branches view's model (concept "git-graph: Branch-Ansicht", variant A2
// "Nur Refs"): the repository as a tree of branch lines, one row per ref, with
// a line's commits listed only when its row is opened.
//
// Pure data-in/data-out over the commit log the app already loads — no DOM, no
// server, no new route. `git log --simplify-by-decoration` cannot stand in for
// it: it drops the commits that tell which branch a fork left from, and draws
// `spike/pdf-fonts` as forking from a tag instead of from `spike/pdf-renderer`.
// `computeGraphLayout` is not used and not touched; this is a sibling for a
// different shape of row list.
//
// The rules, as the concept states them:
//
//   - Lines. Every ref row has a line made of its own first-parent commits. The
//     default branch's first-parent line is handed out first: each row on it
//     owns the commits down to the next row. The other rows then own their
//     first-parent commits down to the first commit already owned, the longest
//     remaining run first. The commit directly below a line's last commit is its
//     fork; there the line joins the line that owns that commit.
//   - Order. Rows follow a walk over history that runs down the default line and
//     emits each commit only after all of its children. Each branch therefore
//     sits directly above its fork, and a branch forked from a branch sits below
//     that branch. Lanes are assigned from these positions over the whole
//     history, so opening a row never moves a lane.
//   - Chains. A row whose fork is another row's tip continues that row's line in
//     the same lane (`main` over `upstream/main`). Merges of the default branch
//     into a feature branch are not drawn; the opened commits show them.
//   - Merges. A row whose tip was merged as a non-first parent gets a second line
//     from that merge down to its node. Commits that arrived through a merge and
//     lie on no line (a deleted branch's) are not drawn; the merge carries their
//     count instead ("+N merged").

/** The part of a commit the model reads. `GitCommit` satisfies it. */
export type BranchTreeCommit = Pick<GitCommit, 'hash' | 'parents' | 'refs'>

/**
 * The commits that get a ref row. A commit with a branch, a remote-tracking ref
 * or HEAD always does. A tag-only commit does when tags are rows, or when nothing
 * in the window descends from it — otherwise its commits would sit under no row
 * at all. For the same reason a commit nothing descends from always gets a row,
 * decorated or not.
 *
 * `remoteNames` is the log's own `remotes`: decorations are read through
 * `classifyRefDecoration`, never by their prefix.
 */
export function refRowSet(
  commits: readonly BranchTreeCommit[],
  remoteNames: readonly string[],
  tagsAreRows: boolean,
): Set<string> {
  const hasChild = new Set<string>()
  for (const commit of commits) for (const parentHash of commit.parents) hasChild.add(parentHash)
  const rows = new Set<string>()
  for (const commit of commits) {
    const kinds = commit.refs
      .map((decoration) => classifyRefDecoration(decoration, remoteNames)?.kind)
      .filter((kind) => kind !== undefined)
    const isTip = !hasChild.has(commit.hash)
    if (kinds.some((kind) => kind !== 'tag') || isTip || (tagsAreRows && kinds.length > 0)) {
      rows.add(commit.hash)
    }
  }
  return rows
}

/**
 * The commit the default branch points at, or null when it is not in the window
 * (or no default branch is known). Only a local branch of that name counts —
 * the name comes from the branch listing, which lists local branches, and no
 * `origin/` prefix is guessed at.
 */
export function findDefaultTip(
  commits: readonly BranchTreeCommit[],
  remoteNames: readonly string[],
  defaultBranch: string | null,
): string | null {
  if (defaultBranch === null) return null
  for (const commit of commits) {
    for (const decoration of commit.refs) {
      const classified = classifyRefDecoration(decoration, remoteNames)
      if (classified?.kind === 'branch' && classified.name === defaultBranch) return commit.hash
    }
  }
  return null
}

/**
 * Which row's line every line commit belongs to (the "Besitzer" rule above).
 * Commits that end up on no line — the side commits of a merge — are absent.
 */
export function assignLineOwners(
  commits: readonly BranchTreeCommit[],
  rows: ReadonlySet<string>,
  defaultTip: string | null,
): Map<string, string> {
  const commitByHash = new Map(commits.map((commit) => [commit.hash, commit]))
  const owner = new Map<string, string>()
  const firstParentOf = (hash: string) => commitByHash.get(hash)?.parents[0]

  // The row's own first-parent commits, down to the next row or owned commit.
  const unclaimedRun = (rowHash: string) => {
    const run = [rowHash]
    let current = firstParentOf(rowHash)
    while (current !== undefined && commitByHash.has(current) && !rows.has(current) && !owner.has(current)) {
      run.push(current)
      current = firstParentOf(current)
    }
    return run
  }
  const claim = (rowHash: string) => {
    for (const hash of unclaimedRun(rowHash)) owner.set(hash, rowHash)
  }

  // 1. The default line: every row on it owns the commits down to the next row.
  if (defaultTip !== null && commitByHash.has(defaultTip)) {
    const rowsOnDefaultLine: string[] = []
    let current: string | undefined = defaultTip
    while (current !== undefined && commitByHash.has(current)) {
      if (rows.has(current)) rowsOnDefaultLine.push(current)
      current = firstParentOf(current)
    }
    if (!rows.has(defaultTip)) rowsOnDefaultLine.unshift(defaultTip)
    for (const rowHash of rowsOnDefaultLine) claim(rowHash)
  }

  // 2. Every other row, the longest remaining run first. Run lengths shrink as
  //    rows claim commits, so they are measured again after each claim. A tie
  //    goes to the row higher in the log.
  const remaining = commits.map((commit) => commit.hash).filter((hash) => rows.has(hash) && !owner.has(hash))
  while (remaining.length > 0) {
    let longestIndex = 0
    let longestLength = -1
    remaining.forEach((rowHash, index) => {
      const length = unclaimedRun(rowHash).length
      if (length > longestLength) {
        longestLength = length
        longestIndex = index
      }
    })
    claim(remaining[longestIndex]!)
    remaining.splice(longestIndex, 1)
  }
  return owner
}

/** The ref rows laid out as a tree of first-parent lines. */
export type BranchTree = {
  /** Every commit of the window, children before parents: the default line from its tip, each branch directly above its fork. */
  order: string[]
  /** Index of each commit in `order`. */
  position: Map<string, number>
  /** The ref rows, in `order`. */
  rows: string[]
  /** A row's own first-parent commits, tip first. */
  run: Map<string, string[]>
  /** The row whose run holds a commit; absent for side commits. */
  runOf: Map<string, string>
  /** The first commit below a row's run (in another row's run); null at the root or edge of the window. */
  fork: Map<string, string | null>
  /** The merge that took a row's tip in as a non-first parent — the lowest one, closest to the tip; null when unmerged. */
  merge: Map<string, string | null>
  /** Lane of each row. */
  lane: Map<string, number>
  laneCount: number
  /** The rows drawn in lane 0 as the default line (the default tip and the rows it continues). Empty with no default tip. */
  defaultLine: Set<string>
}

/**
 * Lay the rows out as a tree of first-parent lines: their runs and forks, the
 * walk order, the merges that took tips in, and the lanes.
 */
export function buildBranchTree(
  commits: readonly BranchTreeCommit[],
  rows: ReadonlySet<string>,
  owners: ReadonlyMap<string, string>,
  defaultTip: string | null,
): BranchTree {
  const commitByHash = new Map(commits.map((commit) => [commit.hash, commit]))
  const inputIndex = new Map(commits.map((commit, index) => [commit.hash, index]))

  // Runs and forks.
  const run = new Map<string, string[]>()
  const runOf = new Map<string, string>()
  const fork = new Map<string, string | null>()
  for (const rowHash of rows) {
    const commitsOfRun = [rowHash]
    let current = rowHash
    let forkHash: string | null = null
    for (;;) {
      const parentHash = commitByHash.get(current)!.parents[0]
      if (parentHash === undefined || !commitByHash.has(parentHash)) break
      if (rows.has(parentHash) || owners.get(parentHash) !== rowHash) {
        forkHash = parentHash
        break
      }
      commitsOfRun.push(parentHash)
      current = parentHash
    }
    run.set(rowHash, commitsOfRun)
    fork.set(rowHash, forkHash)
    for (const hash of commitsOfRun) runOf.set(hash, rowHash)
  }

  // Order: post-order over child edges. Among a commit's children the one in the
  // same run goes first, so a branch's own row lands above the rows of branches
  // forked from it; then log order.
  const children = new Map<string, string[]>()
  for (const commit of commits) {
    for (const parentHash of commit.parents) {
      if (!commitByHash.has(parentHash)) continue
      const list = children.get(parentHash) ?? []
      list.push(commit.hash)
      children.set(parentHash, list)
    }
  }
  const isSameRun = (childHash: string, parentHash: string) =>
    runOf.has(parentHash) && runOf.get(childHash) === runOf.get(parentHash)
  for (const [parentHash, childList] of children) {
    childList.sort(
      (first, second) =>
        Number(isSameRun(second, parentHash)) - Number(isSameRun(first, parentHash)) ||
        inputIndex.get(first)! - inputIndex.get(second)!,
    )
  }
  const order: string[] = []
  const entered = new Set<string>()
  const enter = (startHash: string) => {
    if (entered.has(startHash)) return
    entered.add(startHash)
    const stack: { hash: string; nextChild: number }[] = [{ hash: startHash, nextChild: 0 }]
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!
      const childList = children.get(top.hash) ?? []
      let descended = false
      while (top.nextChild < childList.length) {
        const childHash = childList[top.nextChild++]!
        if (entered.has(childHash)) continue
        entered.add(childHash)
        stack.push({ hash: childHash, nextChild: 0 })
        descended = true
        break
      }
      if (!descended) {
        order.push(top.hash)
        stack.pop()
      }
    }
  }
  const defaultFirstParentLine = new Set<string>()
  let walk: string | undefined = defaultTip ?? undefined
  while (walk !== undefined && commitByHash.has(walk)) {
    defaultFirstParentLine.add(walk)
    enter(walk)
    walk = commitByHash.get(walk)!.parents[0]
  }
  for (const commit of commits) enter(commit.hash)
  const position = new Map(order.map((hash, index) => [hash, index]))
  const orderedRows = order.filter((hash) => rows.has(hash))

  // Merges: a row whose tip a child took in as a non-first parent. The lowest
  // such child is the merge closest to the tip. A row on the default first-parent
  // line records none: a feature merging the default branch in is not drawn
  // (the open commits show it as a merge), and recording it would also stop
  // `main` from continuing over `upstream/main` below.
  const merge = new Map<string, string | null>()
  for (const rowHash of rows) {
    if (defaultFirstParentLine.has(rowHash)) {
      merge.set(rowHash, null)
      continue
    }
    const merges = (children.get(rowHash) ?? []).filter(
      (childHash) => commitByHash.get(childHash)!.parents[0] !== rowHash,
    )
    merge.set(
      rowHash,
      merges.length === 0
        ? null
        : merges.reduce((lowest, candidate) => (position.get(candidate)! > position.get(lowest)! ? candidate : lowest)),
    )
  }

  // Chains: a row whose fork is another row's tip continues that row's line. A
  // tip continues at most one row, the highest; a merged row draws its own merge
  // line and starts no chain.
  const chainOf = new Map<string, string>()
  const continued = new Set<string>()
  for (const rowHash of orderedRows) {
    if (!chainOf.has(rowHash)) chainOf.set(rowHash, rowHash)
    const forkHash = fork.get(rowHash)
    if (forkHash != null && rows.has(forkHash) && !continued.has(forkHash) && merge.get(rowHash) === null) {
      continued.add(forkHash)
      chainOf.set(forkHash, chainOf.get(rowHash)!)
    }
  }
  const chains = new Map<string, string[]>()
  for (const rowHash of orderedRows) {
    const key = chainOf.get(rowHash)!
    const members = chains.get(key) ?? []
    members.push(rowHash)
    chains.set(key, members)
  }

  // Lanes: each chain occupies one lane from its top (its highest node, or the
  // merge that took a member in) to its bottom fork. The default line's chain
  // takes lane 0; every other chain, top first, takes the first lane right of
  // the lane it forks from that is free over its span.
  type Span = { top: number; bottom: number }
  const spanOf = (members: string[]): Span => {
    let top = Infinity
    for (const member of members) {
      top = Math.min(top, position.get(member)!)
      const mergeHash = merge.get(member)
      if (mergeHash != null) top = Math.min(top, position.get(mergeHash)!)
    }
    const bottomFork = fork.get(members[members.length - 1]!)
    return { top, bottom: bottomFork != null ? position.get(bottomFork)! : order.length }
  }
  const lane = new Map<string, number>()
  const occupied: Span[][] = []
  const isFree = (laneIndex: number, span: Span) =>
    (occupied[laneIndex] ?? []).every((taken) => span.bottom < taken.top || span.top > taken.bottom)
  const place = (key: string, laneIndex: number) => {
    const members = chains.get(key)!
    ;(occupied[laneIndex] ??= []).push(spanOf(members))
    for (const member of members) lane.set(member, laneIndex)
  }
  const defaultChain = defaultTip !== null && rows.has(defaultTip) ? chainOf.get(defaultTip)! : null
  if (defaultChain !== null) place(defaultChain, 0)
  const firstFreeLane = defaultChain !== null ? 1 : 0
  const otherChains = [...chains.keys()]
    .filter((key) => key !== defaultChain)
    .sort((first, second) => spanOf(chains.get(first)!).top - spanOf(chains.get(second)!).top)
  for (const key of otherChains) {
    const members = chains.get(key)!
    const forkHash = fork.get(members[members.length - 1]!)
    const forkOwner = forkHash != null ? runOf.get(forkHash) : undefined
    const forkLane = forkOwner !== undefined ? lane.get(forkOwner) : undefined
    let laneIndex = Math.max(firstFreeLane, forkLane !== undefined ? forkLane + 1 : 0)
    const span = spanOf(members)
    while (!isFree(laneIndex, span)) laneIndex++
    place(key, laneIndex)
  }

  return {
    order,
    position,
    rows: orderedRows,
    run,
    runOf,
    fork,
    merge,
    lane,
    laneCount: Math.max(1, occupied.length),
    defaultLine: new Set(defaultChain !== null ? chains.get(defaultChain)! : []),
  }
}

/**
 * The commits each merge on a line brought in that lie on no line — the side
 * commits of a merged branch whose ref no longer exists. Each side commit is
 * counted once, on the lowest merge that reaches it, because that is the merge
 * that brought it in; a later merge of the same history reaches it through its
 * first parent too. Lines plus these cover every commit of the window.
 */
export function attributeMergedCommits(
  commits: readonly BranchTreeCommit[],
  tree: Pick<BranchTree, 'order' | 'runOf'>,
): Map<string, string[]> {
  const commitByHash = new Map(commits.map((commit) => [commit.hash, commit]))
  const attributed = new Set<string>()
  const mergedBy = new Map<string, string[]>()
  for (let index = tree.order.length - 1; index >= 0; index--) {
    const mergeHash = tree.order[index]!
    const mergeCommit = commitByHash.get(mergeHash)!
    if (mergeCommit.parents.length < 2 || !tree.runOf.has(mergeHash)) continue
    const brought: string[] = []
    const pending = mergeCommit.parents.slice(1)
    while (pending.length > 0) {
      const hash = pending.pop()!
      if (attributed.has(hash) || tree.runOf.has(hash) || !commitByHash.has(hash)) continue
      attributed.add(hash)
      brought.push(hash)
      pending.push(...commitByHash.get(hash)!.parents)
    }
    if (brought.length > 0) mergedBy.set(mergeHash, brought)
  }
  return mergedBy
}

/**
 * The name of the line a row leaves at its fork, for the row's "from …" text —
 * or null when there is nothing to say: the row is on the default line, it
 * forks from nothing in the window, or it only continues another row's line in
 * the same lane. The default line is named after the default branch; any other
 * line after the first non-tag ref at its tip, else the tip's hash.
 */
export function lineLeftBy(
  tree: Pick<BranchTree, 'fork' | 'runOf' | 'lane' | 'defaultLine'>,
  rowHash: string,
  refsOf: (hash: string) => readonly string[],
  remoteNames: readonly string[],
  defaultBranch: string | null,
): string | null {
  const forkHash = tree.fork.get(rowHash)
  if (forkHash == null) return null
  const forkRow = tree.runOf.get(forkHash)
  if (forkRow === undefined || tree.lane.get(forkRow) === tree.lane.get(rowHash)) return null
  if (defaultBranch !== null && tree.defaultLine.has(forkRow)) return defaultBranch
  const firstRef = groupRefDecorations(refsOf(forkRow), remoteNames).find(
    (group) => group.kind !== 'tag' && group.kind !== 'head',
  )
  return firstRef !== undefined ? refGroupLabel(firstRef).text : forkRow
}

/** Everything the Branches view draws, derived once per log. */
export type BranchTreeModel = BranchTree & {
  /** The default branch's tip, or null when it is not in the window. */
  defaultTip: string | null
  /** For each merge on a line, the side commits it brought in. */
  mergedBy: Map<string, string[]>
}

export type BranchTreeInput = {
  commits: readonly BranchTreeCommit[]
  /** The log's `remotes`, which classify the decorations. */
  remotes: readonly string[]
  /** The default branch from the branch listing; null when unknown. */
  defaultBranch: string | null
  /** Whether a tag-only commit gets a row of its own. */
  tagsAreRows: boolean
}

/** The steps above, composed: rows, owners, tree, and merged-in side commits. */
export function computeBranchTree({ commits, remotes, defaultBranch, tagsAreRows }: BranchTreeInput): BranchTreeModel {
  const rows = refRowSet(commits, remotes, tagsAreRows)
  const defaultTip = findDefaultTip(commits, remotes, defaultBranch)
  const owners = assignLineOwners(commits, rows, defaultTip)
  const tree = buildBranchTree(commits, rows, owners, defaultTip)
  return { ...tree, defaultTip, mergedBy: attributeMergedCommits(commits, tree) }
}
