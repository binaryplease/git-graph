// The public shared barrel (`git-graph/shared`): the pure, data-in/data-out
// layer the render components are built on, exposed so a host supplies data in
// the exact shapes the components expect. Zod is the single source of truth
// (ADR-0013) — the schemas double as the types via `z.infer`:
//   - git.schema  — the git boundary: GitCommit, CommitDetail, CommitFileChange,
//                   FileDiff, branch listing, comparison, and their schemas.
//   - graphLayout — the lane-sweep algorithm and its input/output types, in case
//                   a host renders the geometry itself.
//   - refGroup    — folding a commit's ref decorations into one group per ref
//                   identity (a local branch and its agreeing remotes become one
//                   pill), plus the classifier the grouping runs on.
//   - fuzzy       — the subsequence matcher with matched-character segments
//                   (ADR-0019), the same one the graph highlights with.
//   - gitActions  — the git-action context menu as data: which entries a commit
//                   row or ref pill offers, why one cannot apply, and what a
//                   checkout says before it runs.
//   - mutationRequest — the header a mutating request must carry, so a host
//                   posting to the write routes sends what the server checks.
export * from './git.schema'
export * from './graphLayout'
export * from './refGroup'
export * from './fuzzy'
export * from './gitActions'
export * from './mutationRequest'
