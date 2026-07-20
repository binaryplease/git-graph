// The standalone file-diff tab lives at its own route so a changed file can be
// opened in a new browser tab (cmd/ctrl/middle-click), the way VS Code's Git
// Graph opens a file's diff in its own editor tab. One descriptor for the URL
// both surfaces agree on (ADR-0026): the commit detail panel's file rows build
// the href, and FileDiffPage parses it back into the fetch arguments.

export const FILE_DIFF_ROUTE = '/diff'

/** The URL of the standalone diff view for one file of one commit. */
export function fileDiffHref(
  repositoryRelativePath: string,
  commitHash: string,
  filePath: string,
): string {
  const query = new URLSearchParams({
    repo: repositoryRelativePath,
    hash: commitHash,
    path: filePath,
  })
  return `${FILE_DIFF_ROUTE}?${query}`
}

export type FileDiffRouteParams = {
  repositoryRelativePath: string
  commitHash: string
  filePath: string
}

/**
 * Parse a diff-tab URL's query back into fetch arguments, or null when the link
 * is missing what it needs. An empty `repo` is valid — the served root is itself
 * a repository — so only the hash and path are required.
 */
export function parseFileDiffParams(search: string): FileDiffRouteParams | null {
  const parameters = new URLSearchParams(search)
  const commitHash = parameters.get('hash')
  const filePath = parameters.get('path')
  if (!commitHash || !filePath) return null
  return {
    repositoryRelativePath: parameters.get('repo') ?? '',
    commitHash,
    filePath,
  }
}
