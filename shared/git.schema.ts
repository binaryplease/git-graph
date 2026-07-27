import { z } from 'zod/v4'

// Shared seam schemas (ADR-0013): the Elysia routes validate responses with
// these, and the client parses fetched payloads through the very same objects.
// This is the typed `git log` boundary — everything downstream (layout,
// rendering) consumes `GitCommit`, never raw git output.

export const GitCommitSchema = z.object({
  hash: z.string().min(1).describe('Abbreviated commit hash (git `%h`).'),
  parents: z
    .array(z.string())
    .default([])
    .describe('Abbreviated parent hashes (git `%p`), first parent first. Empty for root commits.'),
  refs: z
    .array(z.string())
    .default([])
    .describe(
      'Ref decorations pointing at this commit (git `%d`), e.g. `HEAD -> main`, ' +
        '`origin/main`, `tag: v1.0`. Empty for undecorated commits.',
    ),
  author: z.string().default('').describe('Author name (git `%an`).'),
  date: z.string().default('').describe('Author date, `YYYY-MM-DD` (git `%ad` with `--date=short`).'),
  subject: z.string().default('').describe('Commit subject line (git `%s`).'),
})
export type GitCommit = z.infer<typeof GitCommitSchema>

export const RepositorySummarySchema = z.object({
  name: z.string().min(1).describe('Repository directory basename, used as the display name.'),
  relativePath: z
    .string()
    .default('')
    .describe(
      'Repository location relative to the served root — a direct child name, or the empty ' +
        'string when the served root itself is the repository. This is the identifier the ' +
        'commit-log endpoint accepts.',
    ),
})
export type RepositorySummary = z.infer<typeof RepositorySummarySchema>

export const RepositoryListSchema = z.object({
  rootPath: z.string().describe('Absolute path of the served root on the local machine.'),
  repositories: z
    .array(RepositorySummarySchema)
    .default([])
    .describe('Git repositories found at the served root or as its direct children, sorted by name.'),
})
export type RepositoryList = z.infer<typeof RepositoryListSchema>

export const CommitLogSchema = z.object({
  repository: z.string().describe('Display name of the repository the log was read from.'),
  commits: z
    .array(GitCommitSchema)
    .default([])
    .describe(
      'Commits across all refs in topological order (children before all of their parents), ' +
        'as produced by `git log --all --topo-order`. Topological order is what the graph ' +
        'layout algorithm requires.',
    ),
  truncated: z
    .boolean()
    .default(false)
    .describe('True when the history was cut off at the requested limit.'),
})
export type CommitLog = z.infer<typeof CommitLogSchema>

export const CommitLogQuerySchema = z.object({
  repo: z
    .string()
    .default('')
    .describe('Repository identifier: the `relativePath` from the repository listing.'),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(5000)
    .default(1000)
    .describe('Maximum number of commits to return.'),
})
export type CommitLogQuery = z.infer<typeof CommitLogQuerySchema>

export const FileChangeStatusSchema = z
  .enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'type-changed', 'unmerged', 'unknown'])
  .describe('How the file changed in this commit, from the git `--raw` status letter.')
export type FileChangeStatus = z.infer<typeof FileChangeStatusSchema>

export const CommitFileChangeSchema = z.object({
  path: z.string().min(1).describe('Repository-relative path of the file after the change.'),
  previousPath: z
    .string()
    .nullable()
    .default(null)
    .describe('Path before a rename or copy; null for every other status (ADR-0024).'),
  status: FileChangeStatusSchema.default('unknown'),
  additions: z
    .number()
    .int()
    .nullable()
    .default(null)
    .describe('Lines added, or null when git cannot diff the file by line (binary).'),
  deletions: z
    .number()
    .int()
    .nullable()
    .default(null)
    .describe('Lines removed, or null when git cannot diff the file by line (binary).'),
  binary: z.boolean().default(false).describe('True when git reported the file as binary.'),
})
export type CommitFileChange = z.infer<typeof CommitFileChangeSchema>

export const CommitDetailSchema = z.object({
  hash: z.string().min(1).describe('Abbreviated commit hash (git `%h`), matching the graph rows.'),
  fullHash: z.string().min(1).describe('Full 40-character commit hash (git `%H`).'),
  parents: z
    .array(z.string())
    .default([])
    .describe('Abbreviated parent hashes (git `%p`), first parent first. Empty for root commits.'),
  refs: z.array(z.string()).default([]).describe('Ref decorations pointing at this commit (git `%D`).'),
  author: z.string().default('').describe('Author name (git `%an`).'),
  authorEmail: z.string().default('').describe('Author email (git `%ae`).'),
  authorDate: z.string().default('').describe('Author date, ISO 8601 (git `%aI`).'),
  committer: z.string().default('').describe('Committer name (git `%cn`).'),
  committerEmail: z.string().default('').describe('Committer email (git `%ce`).'),
  committerDate: z.string().default('').describe('Committer date, ISO 8601 (git `%cI`).'),
  subject: z.string().default('').describe('Commit subject line (git `%s`).'),
  body: z.string().default('').describe('Commit message body below the subject (git `%b`); empty when there is none.'),
  files: z
    .array(CommitFileChangeSchema)
    .default([])
    .describe(
      'Files changed by this commit. For a merge the diff is taken against the first parent, ' +
        'which is what makes a merge show the changes it brought in.',
    ),
  filesTruncated: z
    .boolean()
    .default(false)
    .describe('True when the commit touches more files than the service returns.'),
})
export type CommitDetail = z.infer<typeof CommitDetailSchema>

export const CommitDetailQuerySchema = z.object({
  repo: z
    .string()
    .default('')
    .describe('Repository identifier: the `relativePath` from the repository listing.'),
  hash: z
    .string()
    .regex(/^[0-9a-fA-F]{4,40}$/, 'must be an abbreviated or full hexadecimal commit hash')
    .describe('Commit to describe — the `hash` of a row in the commit log.'),
})
export type CommitDetailQuery = z.infer<typeof CommitDetailQuerySchema>

export const FileDiffSchema = z.object({
  path: z.string().min(1).describe('Repository-relative path of the file after the change.'),
  previousPath: z
    .string()
    .nullable()
    .default(null)
    .describe('Path before a rename or copy; null for every other status (ADR-0024).'),
  status: FileChangeStatusSchema.default('unknown'),
  hunks: z
    .array(z.string())
    .default([])
    .describe(
      'The unified patch for this file, one entry per `diff --git` block — normally exactly ' +
        'one. Empty when the file is binary or the diff was too large to return.',
    ),
  oldSource: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Complete file contents at the parent commit, or null when there is no parent blob — ' +
        'an added file, a root commit, a binary file, or a truncated diff. Whole-file content ' +
        'is what lets the client tokenize with continuation state instead of line by line.',
    ),
  newSource: z
    .string()
    .nullable()
    .default(null)
    .describe('Complete file contents at this commit, or null for a deleted, binary or truncated file.'),
  language: z
    .string()
    .default('txt')
    .describe('Highlighter language derived from the path; `txt` when the extension is unknown.'),
  binary: z
    .boolean()
    .default(false)
    .describe('True when git cannot diff the file by line — the client shows no diff body.'),
  truncated: z
    .boolean()
    .default(false)
    .describe('True when the file diff exceeded the size the service will return, so it was omitted.'),
})
export type FileDiff = z.infer<typeof FileDiffSchema>

export const FileDiffQuerySchema = z.object({
  repo: z
    .string()
    .default('')
    .describe('Repository identifier: the `relativePath` from the repository listing.'),
  hash: z
    .string()
    .regex(/^[0-9a-fA-F]{4,40}$/, 'must be an abbreviated or full hexadecimal commit hash')
    .describe('Commit the diff is taken at — the `hash` of a row in the commit log.'),
  path: z
    .string()
    .min(1)
    .describe(
      'Repository-relative path of the file to diff. Validated by membership: it must be one ' +
        'of the paths the commit itself reports (or the `previousPath` of a rename), never by ' +
        'pattern.',
    ),
})
export type FileDiffQuery = z.infer<typeof FileDiffQuerySchema>

// A git ref name for a compare view. The real guard is membership — a requested
// ref is rejected unless it is one the repository's own branch listing reports
// (server side) — but this keeps obviously-hostile input (leading dash so it
// cannot read as an option, whitespace, shell metacharacters) off the wire.
export const GIT_REF_NAME_PATTERN = /^(?!-)[A-Za-z0-9._][A-Za-z0-9._/-]*$/

export const BranchSummarySchema = z.object({
  name: z.string().min(1).describe('Short branch name, e.g. `main` or `feature/x`.'),
  isDefault: z
    .boolean()
    .default(false)
    .describe('True for the repository default branch — the base a compare uses when none is given.'),
  isCurrent: z.boolean().default(false).describe('True for the currently checked-out branch (git HEAD).'),
})
export type BranchSummary = z.infer<typeof BranchSummarySchema>

export const BranchListSchema = z.object({
  repository: z.string().describe('Display name of the repository the branches were read from.'),
  defaultBranch: z
    .string()
    .nullable()
    .default(null)
    .describe('The branch a compare diffs against when no base is given (ADR-0024); null if there are no branches.'),
  branches: z
    .array(BranchSummarySchema)
    .default([])
    .describe('Local branches, sorted with the default first, then alphabetically.'),
})
export type BranchList = z.infer<typeof BranchListSchema>

export const BranchListQuerySchema = z.object({
  repo: z.string().default('').describe('Repository identifier: the `relativePath` from the repository listing.'),
})
export type BranchListQuery = z.infer<typeof BranchListQuerySchema>

export const CompareSummarySchema = z.object({
  base: z.string().describe('The branch diffed against — the resolved base (the default branch when none was given).'),
  head: z.string().describe('The branch whose changes are shown, relative to the base.'),
  mergeBase: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Abbreviated hash where the two branches diverged (git `merge-base`); the effective old side ' +
        'of the diff. Null when the branches share no history (ADR-0024).',
    ),
  files: z
    .array(CommitFileChangeSchema)
    .default([])
    .describe('Files that differ between the merge base and the head, as a first-parent-style three-dot diff.'),
  filesTruncated: z
    .boolean()
    .default(false)
    .describe('True when the comparison touches more files than the service returns.'),
})
export type CompareSummary = z.infer<typeof CompareSummarySchema>

export const CompareQuerySchema = z.object({
  repo: z.string().default('').describe('Repository identifier: the `relativePath` from the repository listing.'),
  head: z
    .string()
    .regex(GIT_REF_NAME_PATTERN, 'must be a git branch name')
    .describe('Branch whose changes to show — validated by membership against the branch listing.'),
  base: z
    .string()
    .default('')
    .describe('Branch to diff against; empty means the repository default branch. Validated by membership.'),
})
export type CompareQuery = z.infer<typeof CompareQuerySchema>

export const CompareFileDiffQuerySchema = CompareQuerySchema.extend({
  path: z
    .string()
    .min(1)
    .describe(
      'Repository-relative path of the file to diff. Validated by membership: it must be one of the ' +
        'paths the comparison itself reports (or the `previousPath` of a rename), never by pattern.',
    ),
})
export type CompareFileDiffQuery = z.infer<typeof CompareFileDiffQuerySchema>

export const WorkingTreeSchema = z.object({
  repository: z.string().describe('Display name of the repository the working tree was read from.'),
  head: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Abbreviated hash of HEAD — the commit the uncommitted changes are measured against; null in a ' +
        'repository with no commits yet, where every tracked file reads as an addition (ADR-0024).',
    ),
  branch: z
    .string()
    .nullable()
    .default(null)
    .describe('The checked-out branch name, or null when HEAD is detached or the repository is empty (ADR-0024).'),
  files: z
    .array(CommitFileChangeSchema)
    .default([])
    .describe(
      'Uncommitted changes, sorted by path: modifications and deletions to tracked files (staged or not — ' +
        '`git diff HEAD` folds the index and the worktree together) plus untracked files, each an addition. ' +
        'Empty for a clean working tree.',
    ),
  filesTruncated: z
    .boolean()
    .default(false)
    .describe('True when the working tree touches more files than the service returns.'),
})
export type WorkingTree = z.infer<typeof WorkingTreeSchema>

export const WorkingTreeQuerySchema = z.object({
  repo: z.string().default('').describe('Repository identifier: the `relativePath` from the repository listing.'),
})
export type WorkingTreeQuery = z.infer<typeof WorkingTreeQuerySchema>

export const WorkingFileDiffQuerySchema = WorkingTreeQuerySchema.extend({
  path: z
    .string()
    .min(1)
    .describe(
      'Repository-relative path of the working-tree file to diff. Validated by membership: it must be one of ' +
        'the paths the working tree itself reports (or the `previousPath` of a rename), never by pattern.',
    ),
})
export type WorkingFileDiffQuery = z.infer<typeof WorkingFileDiffQuerySchema>

export const GitErrorSchema = z.object({
  error: z.string().describe('Human-readable description of what went wrong.'),
})
export type GitError = z.infer<typeof GitErrorSchema>
