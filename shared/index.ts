// The public shared barrel (`binp-git-graph/shared`): the pure, data-in/data-out
// layer the render components are built on, exposed so a host supplies data in
// the exact shapes the components expect. Zod is the single source of truth
// (ADR-0013) — the schemas double as the types via `z.infer`:
//   - git.schema  — the git boundary: GitCommit, CommitDetail, CommitFileChange,
//                   FileDiff, branch listing, comparison, and their schemas.
//   - graphLayout — the lane-sweep algorithm and its input/output types, in case
//                   a host renders the geometry itself.
//   - fuzzy       — the subsequence matcher with matched-character segments
//                   (ADR-0019), the same one the graph highlights with.
export * from './git.schema'
export * from './graphLayout'
export * from './fuzzy'
