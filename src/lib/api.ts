import {
  CommitLogSchema,
  RepositoryListSchema,
  type CommitLog,
  type RepositoryList,
} from '../../shared/git.schema'

async function requestJson(path: string): Promise<unknown> {
  const response = await fetch(path)
  if (!response.ok) {
    let message = `request failed with status ${response.status}`
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') message = body.error
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(message)
  }
  return response.json()
}

// Responses are parsed through the same shared schemas the server validates
// with (ADR-0013), so a drifting payload fails loud at the boundary.

export async function fetchRepositories(): Promise<RepositoryList> {
  return RepositoryListSchema.parse(await requestJson('/api/git/repos'))
}

export async function fetchCommitLog(
  repositoryRelativePath: string,
  limit = 1000,
): Promise<CommitLog> {
  const query = new URLSearchParams({ repo: repositoryRelativePath, limit: String(limit) })
  return CommitLogSchema.parse(await requestJson(`/api/git/log?${query}`))
}
