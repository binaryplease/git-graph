import {
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_HEADER_VALUE,
} from '../../shared/mutationRequest'
import {
  BranchListSchema,
  CheckoutResultSchema,
  CommitDetailSchema,
  CommitLogSchema,
  CompareSummarySchema,
  FileDiffSchema,
  RepositoryListSchema,
  WorkingTreeSchema,
  type BranchList,
  type CheckoutResult,
  type CheckoutTarget,
  type CommitDetail,
  type CommitLog,
  type CompareSummary,
  type FileDiff,
  type RepositoryList,
  type WorkingTree,
} from '../../shared/git.schema'

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init)
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

export async function fetchCommitDetail(
  repositoryRelativePath: string,
  commitHash: string,
): Promise<CommitDetail> {
  const query = new URLSearchParams({ repo: repositoryRelativePath, hash: commitHash })
  return CommitDetailSchema.parse(await requestJson(`/api/git/commit?${query}`))
}

export async function fetchFileDiff(
  repositoryRelativePath: string,
  commitHash: string,
  filePath: string,
): Promise<FileDiff> {
  const query = new URLSearchParams({
    repo: repositoryRelativePath,
    hash: commitHash,
    path: filePath,
  })
  return FileDiffSchema.parse(await requestJson(`/api/git/diff?${query}`))
}

export async function fetchBranches(repositoryRelativePath: string): Promise<BranchList> {
  const query = new URLSearchParams({ repo: repositoryRelativePath })
  return BranchListSchema.parse(await requestJson(`/api/git/branches?${query}`))
}

export async function fetchCompareSummary(
  repositoryRelativePath: string,
  headBranch: string,
  baseBranch = '',
): Promise<CompareSummary> {
  const query = new URLSearchParams({ repo: repositoryRelativePath, head: headBranch })
  if (baseBranch) query.set('base', baseBranch)
  return CompareSummarySchema.parse(await requestJson(`/api/git/compare?${query}`))
}

export async function fetchCompareFileDiff(
  repositoryRelativePath: string,
  headBranch: string,
  filePath: string,
  baseBranch = '',
): Promise<FileDiff> {
  const query = new URLSearchParams({ repo: repositoryRelativePath, head: headBranch, path: filePath })
  if (baseBranch) query.set('base', baseBranch)
  return FileDiffSchema.parse(await requestJson(`/api/git/compare/diff?${query}`))
}

export async function fetchWorkingTree(repositoryRelativePath: string): Promise<WorkingTree> {
  const query = new URLSearchParams({ repo: repositoryRelativePath })
  return WorkingTreeSchema.parse(await requestJson(`/api/git/working?${query}`))
}

export async function fetchWorkingFileDiff(
  repositoryRelativePath: string,
  filePath: string,
): Promise<FileDiff> {
  const query = new URLSearchParams({ repo: repositoryRelativePath, path: filePath })
  return FileDiffSchema.parse(await requestJson(`/api/git/working/diff?${query}`))
}

/**
 * Check out a branch, tag, or commit — a write to the repository on disk. It
 * carries the header and JSON body every mutating route requires
 * (`shared/mutationRequest.ts`), which is what a foreign page cannot send. On a
 * refusal the thrown message is the server's, which for a checkout git refused
 * is git's own stderr.
 */
export async function checkout(repositoryRelativePath: string, target: CheckoutTarget): Promise<CheckoutResult> {
  return CheckoutResultSchema.parse(
    await requestJson('/api/git/checkout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_HEADER_VALUE,
      },
      body: JSON.stringify({ repo: repositoryRelativePath, target }),
    }),
  )
}
