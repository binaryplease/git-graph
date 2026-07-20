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

export const GitErrorSchema = z.object({
  error: z.string().describe('Human-readable description of what went wrong.'),
})
export type GitError = z.infer<typeof GitErrorSchema>
