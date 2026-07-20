import { Elysia } from 'elysia'
import { config } from '../config'
import {
  createGitService,
  type ReadCommitDetailFailureReason,
  type ReadCommitLogFailureReason,
  type ReadFileDiffFailureReason,
} from '../services/git'
import {
  CommitDetailQuerySchema,
  CommitDetailSchema,
  CommitLogQuerySchema,
  CommitLogSchema,
  FileDiffQuerySchema,
  FileDiffSchema,
  GitErrorSchema,
  RepositoryListSchema,
} from '../../shared/git.schema'

// Created at startup so a bad GIT_GRAPH_ROOT crashes the boot, not a request.
const gitService = createGitService({ rootAbsolutePath: config.GIT_GRAPH_ROOT })

function failureStatusAndMessage(
  reason: ReadCommitLogFailureReason,
  repositoryIdentifier: string,
  detail?: string,
): { statusCode: 404 | 500; message: string } {
  switch (reason) {
    case 'unknown-repository':
      return {
        statusCode: 404,
        message: `no such repository at the served root: ${repositoryIdentifier || '(root)'}`,
      }
    case 'git-failed':
      return { statusCode: 500, message: `git log failed: ${detail || 'unknown error'}` }
  }
}

function detailFailureStatusAndMessage(
  reason: ReadCommitDetailFailureReason,
  repositoryIdentifier: string,
  commitHash: string,
  detail?: string,
): { statusCode: 400 | 404 | 500; message: string } {
  switch (reason) {
    case 'unknown-repository':
      return {
        statusCode: 404,
        message: `no such repository at the served root: ${repositoryIdentifier || '(root)'}`,
      }
    case 'unknown-commit':
      return { statusCode: 404, message: `no such commit in this repository: ${commitHash}` }
    case 'invalid-hash':
      return { statusCode: 400, message: `not a commit hash: ${commitHash}` }
    case 'git-failed':
      return { statusCode: 500, message: `git show failed: ${detail || 'unknown error'}` }
  }
}

function fileDiffFailureStatusAndMessage(
  reason: ReadFileDiffFailureReason,
  repositoryIdentifier: string,
  commitHash: string,
  filePath: string,
  detail?: string,
): { statusCode: 400 | 404 | 500; message: string } {
  if (reason === 'unknown-file') {
    return {
      statusCode: 404,
      message: `commit ${commitHash} does not touch this file: ${filePath}`,
    }
  }
  return detailFailureStatusAndMessage(reason, repositoryIdentifier, commitHash, detail)
}

export const gitRoutes = new Elysia()
  .get(
    '/api/git/repos',
    () => gitService.listRepositories(),
    {
      response: { 200: RepositoryListSchema },
      detail: {
        tags: ['git'],
        summary: 'List repositories',
        description:
          'Lists the git repositories found at the served root (`GIT_GRAPH_ROOT`, defaulting to ' +
          'the home directory of the user running the server): the root itself when it is a ' +
          'repository, plus its direct children. The returned `relativePath` is the identifier ' +
          'the commit-log endpoint accepts.',
      },
    },
  )
  .get(
    '/api/git/log',
    async ({ query, status }) => {
      const result = await gitService.readCommitLog(query.repo, { limit: query.limit })
      if (!result.ok) {
        const { statusCode, message } = failureStatusAndMessage(result.reason, query.repo, result.detail)
        return status(statusCode, { error: message })
      }
      return result.log
    },
    {
      query: CommitLogQuerySchema,
      response: {
        200: CommitLogSchema,
        404: GitErrorSchema,
        500: GitErrorSchema,
      },
      detail: {
        tags: ['git'],
        summary: 'Read a commit log',
        description:
          'Runs `git log --all --topo-order` in the identified repository and returns the parsed ' +
          'commits — children before all of their parents, which is the order the graph layout ' +
          'requires. Identifiers not present in the repository listing are rejected with 404.',
      },
    },
  )
  .get(
    '/api/git/commit',
    async ({ query, status }) => {
      const result = await gitService.readCommitDetail(query.repo, query.hash)
      if (!result.ok) {
        const { statusCode, message } = detailFailureStatusAndMessage(
          result.reason,
          query.repo,
          query.hash,
          result.detail,
        )
        return status(statusCode, { error: message })
      }
      return result.detail
    },
    {
      query: CommitDetailQuerySchema,
      response: {
        200: CommitDetailSchema,
        400: GitErrorSchema,
        404: GitErrorSchema,
        500: GitErrorSchema,
      },
      detail: {
        tags: ['git'],
        summary: 'Describe one commit',
        description:
          'Runs `git show` for a single commit and returns its full metadata, message body, and ' +
          'the list of files it changed with per-file line counts. For a merge commit the diff ' +
          'is taken against the first parent, so the response shows what the merge brought in. ' +
          'The repository must be present in the listing (404 otherwise), and the hash must be ' +
          'hexadecimal — a malformed one is rejected by query validation with 422 before it can ' +
          'reach git.',
      },
    },
  )
  .get(
    '/api/git/diff',
    async ({ query, status }) => {
      const result = await gitService.readFileDiff(query.repo, query.hash, query.path)
      if (!result.ok) {
        const { statusCode, message } = fileDiffFailureStatusAndMessage(
          result.reason,
          query.repo,
          query.hash,
          query.path,
          result.detail,
        )
        return status(statusCode, { error: message })
      }
      return result.diff
    },
    {
      query: FileDiffQuerySchema,
      response: {
        200: FileDiffSchema,
        400: GitErrorSchema,
        404: GitErrorSchema,
        500: GitErrorSchema,
      },
      detail: {
        tags: ['git'],
        summary: 'Diff one file of one commit',
        description:
          'Returns the unified patch for a single file together with both complete blobs the ' +
          'patch applies between, so a client can syntax-highlight whole files instead of ' +
          'highlighting each line in isolation. `oldSource` is null for an added file or a root ' +
          'commit and `newSource` is null for a deletion; a binary file returns no patch and no ' +
          'sources, and an oversized diff comes back with `truncated: true` and nothing else. ' +
          'For a merge the diff is taken against the first parent, matching the commit endpoint. ' +
          'The requested `path` must be one the commit itself reports — validation is a ' +
          'membership check against git output, not a pattern — and an unrelated path is ' +
          'rejected with 404.',
      },
    },
  )
