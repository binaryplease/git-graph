import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { COMMIT_LOG_ARGUMENTS, parseGitLog } from '../../shared/gitLog'
import { COMMIT_DETAIL_ARGUMENTS, parseCommitDetail } from '../../shared/commitDetail'
import type { CommitDetail, CommitLog, RepositoryList, RepositorySummary } from '../../shared/git.schema'

export type ReadCommitLogFailureReason = 'unknown-repository' | 'git-failed'

export type ReadCommitLogResult =
  | { ok: true; log: CommitLog }
  | { ok: false; reason: ReadCommitLogFailureReason; detail?: string }

export type ReadCommitDetailFailureReason =
  | 'unknown-repository'
  | 'unknown-commit'
  | 'invalid-hash'
  | 'git-failed'

export type ReadCommitDetailResult =
  | { ok: true; detail: CommitDetail }
  | { ok: false; reason: ReadCommitDetailFailureReason; detail?: string }

// Hashes reach `git show` as an argument, so they are re-checked here even
// though the route schema already validates them — the service is the boundary
// that owns what may be handed to the shell.
const COMMIT_HASH_PATTERN = /^[0-9a-fA-F]{4,40}$/

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
   * Resolve a repository identifier from the listing. Identifiers are always
   * re-validated against it, so arbitrary paths can never reach the shell.
   */
  async function resolveRepository(repositoryRelativePath: string) {
    const { repositories } = await listRepositories()
    return repositories.find((candidate) => candidate.relativePath === repositoryRelativePath)
  }

  /** Run git in a resolved repository and collect its output. */
  async function runGit(repositoryPath: string, gitArguments: string[]) {
    const gitProcess = Bun.spawn(['git', '-C', repositoryPath, ...gitArguments], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(gitProcess.stdout).text(),
      new Response(gitProcess.stderr).text(),
      gitProcess.exited,
    ])
    return { stdout, stderr, exitCode }
  }

  /**
   * Read the commit history of one listed repository via `git log --all
   * --topo-order`.
   */
  async function readCommitLog(
    repositoryRelativePath: string,
    { limit }: { limit: number },
  ): Promise<ReadCommitLogResult> {
    const repository = await resolveRepository(repositoryRelativePath)
    if (!repository) return { ok: false, reason: 'unknown-repository' }

    const { stdout, stderr, exitCode } = await runGit(join(servedRoot, repository.relativePath), [
      ...COMMIT_LOG_ARGUMENTS,
      '-n',
      String(limit),
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

  /**
   * Describe a single commit: its full metadata, message body, and the files it
   * changed (against the first parent for merges). The hash is checked against
   * {@link COMMIT_HASH_PATTERN} and passed after `--`, so it can never be read
   * as an option or a path.
   */
  async function readCommitDetail(
    repositoryRelativePath: string,
    commitHash: string,
  ): Promise<ReadCommitDetailResult> {
    if (!COMMIT_HASH_PATTERN.test(commitHash)) return { ok: false, reason: 'invalid-hash' }

    const repository = await resolveRepository(repositoryRelativePath)
    if (!repository) return { ok: false, reason: 'unknown-repository' }

    const { stdout, stderr, exitCode } = await runGit(join(servedRoot, repository.relativePath), [
      ...COMMIT_DETAIL_ARGUMENTS,
      commitHash,
      '--',
    ])

    if (exitCode !== 0) {
      // git phrases a missing object several ways depending on how the
      // revision failed to resolve; all of them mean "no such commit here".
      if (
        /unknown revision|bad revision|bad object|ambiguous argument|does not have any commits yet/i.test(
          stderr,
        )
      ) {
        return { ok: false, reason: 'unknown-commit' }
      }
      return { ok: false, reason: 'git-failed', detail: stderr.trim() }
    }

    const parsed = parseCommitDetail(stdout)
    if (!parsed) return { ok: false, reason: 'git-failed', detail: 'could not parse git show output' }
    return { ok: true, detail: parsed }
  }

  return { listRepositories, readCommitLog, readCommitDetail }
}

export type GitService = ReturnType<typeof createGitService>
