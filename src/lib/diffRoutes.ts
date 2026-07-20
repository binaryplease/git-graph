// The standalone diff tabs live at their own routes so a change can be opened in
// a new browser tab (cmd/ctrl/middle-click), the way VS Code's Git Graph opens a
// diff in its own editor tab. One descriptor for every diff-view URL (ADR-0026):
// the commit detail panel builds the hrefs, and each page parses them back into
// its fetch arguments. Three shapes:
//   /diff    — one file of one commit
//   /commit  — a whole commit (file list + every file's diff)
//   /compare — a branch against a base (default: the repository default branch)

export const FILE_DIFF_ROUTE = '/diff'
export const COMMIT_DIFF_ROUTE = '/commit'
export const COMPARE_ROUTE = '/compare'

/** The URL of the standalone diff view for one file of one commit. */
export function fileDiffHref(
  repositoryRelativePath: string,
  commitHash: string,
  filePath: string,
): string {
  const query = new URLSearchParams({ repo: repositoryRelativePath, hash: commitHash, path: filePath })
  return `${FILE_DIFF_ROUTE}?${query}`
}

/** The URL of the full-commit view — metadata, file list, and every file's diff. */
export function commitDiffHref(repositoryRelativePath: string, commitHash: string): string {
  const query = new URLSearchParams({ repo: repositoryRelativePath, hash: commitHash })
  return `${COMMIT_DIFF_ROUTE}?${query}`
}

/**
 * The URL comparing a branch against a base. An omitted base is left out of the
 * query so the server resolves the repository default branch — "against main if
 * not otherwise specified".
 */
export function compareHref(
  repositoryRelativePath: string,
  headBranch: string,
  baseBranch?: string,
): string {
  const query = new URLSearchParams({ repo: repositoryRelativePath, head: headBranch })
  if (baseBranch) query.set('base', baseBranch)
  return `${COMPARE_ROUTE}?${query}`
}

export type FileDiffRouteParams = {
  repositoryRelativePath: string
  commitHash: string
  filePath: string
}

/**
 * Parse a file-diff URL's query, or null when it is missing what it needs. An
 * empty `repo` is valid — the served root is itself a repository — so only the
 * hash and path are required.
 */
export function parseFileDiffParams(search: string): FileDiffRouteParams | null {
  const parameters = new URLSearchParams(search)
  const commitHash = parameters.get('hash')
  const filePath = parameters.get('path')
  if (!commitHash || !filePath) return null
  return { repositoryRelativePath: parameters.get('repo') ?? '', commitHash, filePath }
}

export type CommitDiffRouteParams = {
  repositoryRelativePath: string
  commitHash: string
}

/** Parse a full-commit URL's query, or null when the commit hash is missing. */
export function parseCommitDiffParams(search: string): CommitDiffRouteParams | null {
  const parameters = new URLSearchParams(search)
  const commitHash = parameters.get('hash')
  if (!commitHash) return null
  return { repositoryRelativePath: parameters.get('repo') ?? '', commitHash }
}

export type CompareRouteParams = {
  repositoryRelativePath: string
  headBranch: string
  /** Empty string means "let the server resolve the default branch". */
  baseBranch: string
}

/** Parse a compare URL's query, or null when the head branch is missing. */
export function parseCompareParams(search: string): CompareRouteParams | null {
  const parameters = new URLSearchParams(search)
  const headBranch = parameters.get('head')
  if (!headBranch) return null
  return {
    repositoryRelativePath: parameters.get('repo') ?? '',
    headBranch,
    baseBranch: parameters.get('base') ?? '',
  }
}
