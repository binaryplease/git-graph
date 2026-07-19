import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { COMMIT_LOG_ARGUMENTS, parseGitLog } from '../../shared/gitLog'
import type { CommitLog, RepositoryList, RepositorySummary } from '../../shared/git.schema'

export type ReadCommitLogFailureReason = 'unknown-repository' | 'git-failed'

export type ReadCommitLogResult =
  | { ok: true; log: CommitLog }
  | { ok: false; reason: ReadCommitLogFailureReason; detail?: string }

// A `.git` entry marks a repository — a directory for normal clones, a file
// for worktrees and submodules. Both render fine, so both count.
const isGitRepository = (directoryPath: string) => existsSync(join(directoryPath, '.git'))

export function createGitService({ rootAbsolutePath }: { rootAbsolutePath: string }) {
  const servedRoot = resolve(rootAbsolutePath)
  if (!existsSync(servedRoot)) {
    throw new Error(`git-graph root does not exist: ${servedRoot}`)
  }

  /** Repositories at the served root: the root itself (if it is one) plus direct children. */
  async function listRepositories(): Promise<RepositoryList> {
    const repositories: RepositorySummary[] = []
    if (isGitRepository(servedRoot)) {
      repositories.push({ name: basename(servedRoot), relativePath: '' })
    }
    const entries = await readdir(servedRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (isGitRepository(join(servedRoot, entry.name))) {
        repositories.push({ name: entry.name, relativePath: entry.name })
      }
    }
    repositories.sort((first, second) => first.name.localeCompare(second.name))
    return { rootPath: servedRoot, repositories }
  }

  /**
   * Read the commit history of one listed repository via `git log --all
   * --topo-order`. The repository is identified by its `relativePath` from the
   * listing and re-validated against it, so arbitrary paths can never reach
   * the shell.
   */
  async function readCommitLog(
    repositoryRelativePath: string,
    { limit }: { limit: number },
  ): Promise<ReadCommitLogResult> {
    const { repositories } = await listRepositories()
    const repository = repositories.find(
      (candidate) => candidate.relativePath === repositoryRelativePath,
    )
    if (!repository) return { ok: false, reason: 'unknown-repository' }

    const repositoryPath = join(servedRoot, repository.relativePath)
    const gitProcess = Bun.spawn(
      ['git', '-C', repositoryPath, ...COMMIT_LOG_ARGUMENTS, '-n', String(limit)],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(gitProcess.stdout).text(),
      new Response(gitProcess.stderr).text(),
      gitProcess.exited,
    ])

    if (exitCode !== 0) {
      // A freshly-initialized repository has no refs yet — that is an empty
      // graph, not an error.
      if (/does not have any commits yet|bad default revision/i.test(stderr)) {
        return { ok: true, log: { repository: repository.name, commits: [], truncated: false } }
      }
      return { ok: false, reason: 'git-failed', detail: stderr.trim() }
    }

    const commits = parseGitLog(stdout)
    return {
      ok: true,
      log: { repository: repository.name, commits, truncated: commits.length >= limit },
    }
  }

  return { listRepositories, readCommitLog }
}

export type GitService = ReturnType<typeof createGitService>
