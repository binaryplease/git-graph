import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { COMMIT_LOG_ARGUMENTS, parseGitLog } from '../../shared/gitLog'
import { COMMIT_DETAIL_ARGUMENTS, parseCommitDetail } from '../../shared/commitDetail'
import {
  FILE_DIFF_ARGUMENTS,
  MAX_FILE_DIFF_BYTES,
  languageForPath,
  splitPatchIntoFileHunks,
} from '../../shared/fileDiff'
import {
  COMPARE_FILE_DIFF_ARGUMENTS,
  COMPARE_SUMMARY_ARGUMENTS,
  compareRevisionArguments,
} from '../../shared/compareDiff'
import {
  EMPTY_TREE_HASH,
  LIST_UNTRACKED_ARGUMENTS,
  NO_INDEX_DIFFERENCES_EXIT_CODE,
  UNTRACKED_FILE_DIFF_ARGUMENTS,
  WORKING_FILE_DIFF_ARGUMENTS,
  WORKING_SUMMARY_ARGUMENTS,
  isBinaryNoIndexPatch,
} from '../../shared/workingTree'
import { MAX_FILE_CHANGES, parseCommitFileChanges } from '../../shared/commitDetail'
import { FIELD_SEPARATOR } from '../../shared/gitLog'
import type {
  BranchList,
  CommitDetail,
  CommitFileChange,
  CommitLog,
  CompareSummary,
  FileDiff,
  RepositoryList,
  RepositorySummary,
  WorkingTree,
} from '../../shared/git.schema'

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

export type ReadFileDiffFailureReason = ReadCommitDetailFailureReason | 'unknown-file'

export type ReadFileDiffResult =
  | { ok: true; diff: FileDiff }
  | { ok: false; reason: ReadFileDiffFailureReason; detail?: string }

export type ReadBranchesFailureReason = 'unknown-repository' | 'git-failed'

export type ReadBranchesResult =
  | { ok: true; branches: BranchList }
  | { ok: false; reason: ReadBranchesFailureReason; detail?: string }

export type ReadCompareFailureReason = 'unknown-repository' | 'unknown-ref' | 'git-failed'

export type ReadCompareSummaryResult =
  | { ok: true; summary: CompareSummary }
  | { ok: false; reason: ReadCompareFailureReason; detail?: string }

export type ReadCompareFileDiffFailureReason = ReadCompareFailureReason | 'unknown-file'

export type ReadCompareFileDiffResult =
  | { ok: true; diff: FileDiff }
  | { ok: false; reason: ReadCompareFileDiffFailureReason; detail?: string }

export type ReadWorkingTreeFailureReason = 'unknown-repository' | 'git-failed'

export type ReadWorkingTreeResult =
  | { ok: true; working: WorkingTree }
  | { ok: false; reason: ReadWorkingTreeFailureReason; detail?: string }

export type ReadWorkingFileDiffFailureReason = ReadWorkingTreeFailureReason | 'unknown-file'

export type ReadWorkingFileDiffResult =
  | { ok: true; diff: FileDiff }
  | { ok: false; reason: ReadWorkingFileDiffFailureReason; detail?: string }

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

  /**
   * The unified patch for one file of one commit, plus both complete blobs the
   * patch applies between.
   *
   * `filePath` is untrusted input, and it is validated by **membership**, not
   * by pattern: the commit's own file listing is read first and the request is
   * rejected unless git itself named this path (or named it as the source of a
   * rename). That makes the guard a lookup against data git produced, which no
   * regex can match for strength. The path is still passed after `--`, and the
   * hash still goes through {@link COMMIT_HASH_PATTERN}.
   */
  async function readFileDiff(
    repositoryRelativePath: string,
    commitHash: string,
    filePath: string,
  ): Promise<ReadFileDiffResult> {
    const repository = await resolveRepository(repositoryRelativePath)
    if (!repository) return { ok: false, reason: 'unknown-repository' }

    const detailResult = await readCommitDetail(repositoryRelativePath, commitHash)
    if (!detailResult.ok) return detailResult

    const { detail } = detailResult
    const fileChange = detail.files.find(
      (candidate) => candidate.path === filePath || candidate.previousPath === filePath,
    )
    if (!fileChange) return { ok: false, reason: 'unknown-file' }

    // From here on the paths handed to git are git's own strings, not the
    // caller's. The old side of a rename lives at the previous path.
    const newPath = fileChange.path
    const oldPath = fileChange.previousPath ?? fileChange.path
    const repositoryPath = join(servedRoot, repository.relativePath)
    const pathArguments = fileChange.previousPath !== null ? [oldPath, newPath] : [newPath]

    const base: FileDiff = {
      path: newPath,
      previousPath: fileChange.previousPath,
      status: fileChange.status,
      hunks: [],
      oldSource: null,
      newSource: null,
      language: languageForPath(newPath),
      binary: fileChange.binary,
      truncated: false,
    }

    // A binary file has no line diff and no source worth sending; the row stays
    // in the listing and the client explains why it cannot be expanded.
    if (fileChange.binary) return { ok: true, diff: base }

    const patch = await runGit(repositoryPath, [
      ...FILE_DIFF_ARGUMENTS,
      commitHash,
      '--',
      ...pathArguments,
    ])
    if (patch.exitCode !== 0) {
      return { ok: false, reason: 'git-failed', detail: patch.stderr.trim() }
    }

    // `git show <hash>^:<path>` fails for an added file and for a root commit —
    // both mean "no blob on the old side", not an error. Same on the new side
    // for a deletion.
    const hasOldSide = fileChange.status !== 'added' && detail.parents.length > 0
    const hasNewSide = fileChange.status !== 'deleted'
    const [oldBlob, newBlob] = await Promise.all([
      hasOldSide ? runGit(repositoryPath, ['show', `${commitHash}^:${oldPath}`]) : null,
      hasNewSide ? runGit(repositoryPath, ['show', `${commitHash}:${newPath}`]) : null,
    ])

    const oldSource = oldBlob?.exitCode === 0 ? oldBlob.stdout : null
    const newSource = newBlob?.exitCode === 0 ? newBlob.stdout : null

    const totalBytes =
      Buffer.byteLength(patch.stdout) +
      Buffer.byteLength(oldSource ?? '') +
      Buffer.byteLength(newSource ?? '')
    // Over the cap the payload is dropped whole rather than clipped: the client
    // highlights complete files, so a clipped blob would highlight the wrong
    // thing rather than merely showing less.
    if (totalBytes > MAX_FILE_DIFF_BYTES) return { ok: true, diff: { ...base, truncated: true } }

    return {
      ok: true,
      diff: {
        ...base,
        hunks: splitPatchIntoFileHunks(patch.stdout),
        oldSource,
        newSource,
      },
    }
  }

  /**
   * The default branch a comparison uses as its base when none is given: the
   * target of `origin/HEAD` when a remote names one, otherwise `main`, then
   * `master`, then the checked-out branch, then the first branch. Null only when
   * the repository has no branches at all.
   */
  async function resolveDefaultBranch(
    repositoryPath: string,
    branchNames: string[],
    currentBranch: string | null,
  ): Promise<string | null> {
    if (branchNames.length === 0) return null
    const originHead = await runGit(repositoryPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    if (originHead.exitCode === 0) {
      const originDefault = originHead.stdout.trim().replace(/^origin\//, '')
      if (branchNames.includes(originDefault)) return originDefault
    }
    if (branchNames.includes('main')) return 'main'
    if (branchNames.includes('master')) return 'master'
    if (currentBranch && branchNames.includes(currentBranch)) return currentBranch
    return branchNames[0] ?? null
  }

  /** Read a repository's local branch names, the checked-out one, and the default. */
  async function readBranchData(repositoryPath: string) {
    const { stdout, stderr, exitCode } = await runGit(repositoryPath, [
      'for-each-ref',
      `--format=%(refname:short)${FIELD_SEPARATOR}%(HEAD)`,
      'refs/heads',
    ])
    if (exitCode !== 0) return { ok: false as const, detail: stderr.trim() }

    const branchNames: string[] = []
    let currentBranch: string | null = null
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      const [name, headMarker] = line.split(FIELD_SEPARATOR)
      if (!name) continue
      branchNames.push(name)
      if (headMarker?.trim() === '*') currentBranch = name
    }
    const defaultBranch = await resolveDefaultBranch(repositoryPath, branchNames, currentBranch)
    return { ok: true as const, branchNames, currentBranch, defaultBranch }
  }

  /** List the local branches of one listed repository, default branch first. */
  async function readBranches(repositoryRelativePath: string): Promise<ReadBranchesResult> {
    const repository = await resolveRepository(repositoryRelativePath)
    if (!repository) return { ok: false, reason: 'unknown-repository' }

    const data = await readBranchData(join(servedRoot, repository.relativePath))
    if (!data.ok) return { ok: false, reason: 'git-failed', detail: data.detail }

    const branches = data.branchNames
      .map((name) => ({
        name,
        isDefault: name === data.defaultBranch,
        isCurrent: name === data.currentBranch,
      }))
      // Default first, then alphabetical — the base a compare picks by default
      // is the one a reader most wants at the top of the list.
      .sort((first, second) => {
        if (first.isDefault !== second.isDefault) return first.isDefault ? -1 : 1
        return first.name.localeCompare(second.name)
      })

    return {
      ok: true,
      branches: { repository: repository.name, defaultBranch: data.defaultBranch, branches },
    }
  }

  /**
   * Resolve and validate a comparison's endpoints. Both refs are checked by
   * **membership** against the repository's own branch listing — the same
   * discipline the file-diff path uses — so only names git itself produced ever
   * reach the shell. An empty base means "the default branch".
   */
  async function resolveComparison(repositoryRelativePath: string, headRef: string, baseRef: string) {
    const repository = await resolveRepository(repositoryRelativePath)
    if (!repository) return { ok: false as const, reason: 'unknown-repository' as const }

    const repositoryPath = join(servedRoot, repository.relativePath)
    const data = await readBranchData(repositoryPath)
    if (!data.ok) return { ok: false as const, reason: 'git-failed' as const, detail: data.detail }

    const branchNames = new Set(data.branchNames)
    const resolvedBase = baseRef || data.defaultBranch || ''
    if (!resolvedBase || !branchNames.has(resolvedBase)) {
      return { ok: false as const, reason: 'unknown-ref' as const, detail: `no such branch: ${resolvedBase || '(default)'}` }
    }
    if (!branchNames.has(headRef)) {
      return { ok: false as const, reason: 'unknown-ref' as const, detail: `no such branch: ${headRef}` }
    }

    const mergeBaseResult = await runGit(repositoryPath, ['merge-base', resolvedBase, headRef])
    const mergeBase = mergeBaseResult.exitCode === 0 ? mergeBaseResult.stdout.trim() : null
    return { ok: true as const, repositoryPath, base: resolvedBase, head: headRef, mergeBase }
  }

  /**
   * The files that differ between a branch and its base — the three-dot,
   * merge-base comparison a pull request shows. Reuses the commit-detail file
   * parser, since `git diff --raw --numstat` produces the same wire format.
   */
  async function readCompareSummary(
    repositoryRelativePath: string,
    headRef: string,
    baseRef: string,
  ): Promise<ReadCompareSummaryResult> {
    const comparison = await resolveComparison(repositoryRelativePath, headRef, baseRef)
    if (!comparison.ok) return comparison

    const { repositoryPath, base, head, mergeBase } = comparison
    const diff = await runGit(repositoryPath, [
      ...COMPARE_SUMMARY_ARGUMENTS,
      ...compareRevisionArguments(base, head, mergeBase !== null),
      '--',
    ])
    if (diff.exitCode !== 0) return { ok: false, reason: 'git-failed', detail: diff.stderr.trim() }

    const abbreviatedMergeBase = mergeBase
      ? (await runGit(repositoryPath, ['rev-parse', '--short', mergeBase])).stdout.trim() || mergeBase.slice(0, 9)
      : null
    const { files, truncated } = parseCommitFileChanges(diff.stdout)
    return {
      ok: true,
      summary: { base, head, mergeBase: abbreviatedMergeBase, files, filesTruncated: truncated },
    }
  }

  /**
   * The unified patch for one file of a branch comparison, plus both complete
   * blobs the patch applies between. `filePath` is validated by membership
   * against the comparison's own file listing, exactly as {@link readFileDiff}
   * validates against a commit's listing. The old side is the merge-base blob,
   * which is what makes the diff match the three-dot summary.
   */
  async function readCompareFileDiff(
    repositoryRelativePath: string,
    headRef: string,
    baseRef: string,
    filePath: string,
  ): Promise<ReadCompareFileDiffResult> {
    const comparison = await resolveComparison(repositoryRelativePath, headRef, baseRef)
    if (!comparison.ok) return comparison

    const { repositoryPath, base, head, mergeBase } = comparison
    const summary = await runGit(repositoryPath, [
      ...COMPARE_SUMMARY_ARGUMENTS,
      ...compareRevisionArguments(base, head, mergeBase !== null),
      '--',
    ])
    if (summary.exitCode !== 0) return { ok: false, reason: 'git-failed', detail: summary.stderr.trim() }

    const { files } = parseCommitFileChanges(summary.stdout)
    const fileChange = files.find(
      (candidate) => candidate.path === filePath || candidate.previousPath === filePath,
    )
    if (!fileChange) return { ok: false, reason: 'unknown-file' }

    // From here the paths handed to git are git's own strings, not the caller's.
    const newPath = fileChange.path
    const oldPath = fileChange.previousPath ?? fileChange.path
    const oldRef = mergeBase ?? base
    const pathArguments = fileChange.previousPath !== null ? [oldPath, newPath] : [newPath]

    const base_: FileDiff = {
      path: newPath,
      previousPath: fileChange.previousPath,
      status: fileChange.status,
      hunks: [],
      oldSource: null,
      newSource: null,
      language: languageForPath(newPath),
      binary: fileChange.binary,
      truncated: false,
    }
    if (fileChange.binary) return { ok: true, diff: base_ }

    const patch = await runGit(repositoryPath, [
      ...COMPARE_FILE_DIFF_ARGUMENTS,
      ...compareRevisionArguments(base, head, mergeBase !== null),
      '--',
      ...pathArguments,
    ])
    if (patch.exitCode !== 0) return { ok: false, reason: 'git-failed', detail: patch.stderr.trim() }

    const hasOldSide = fileChange.status !== 'added'
    const hasNewSide = fileChange.status !== 'deleted'
    const [oldBlob, newBlob] = await Promise.all([
      hasOldSide ? runGit(repositoryPath, ['show', `${oldRef}:${oldPath}`]) : null,
      hasNewSide ? runGit(repositoryPath, ['show', `${head}:${newPath}`]) : null,
    ])

    const oldSource = oldBlob?.exitCode === 0 ? oldBlob.stdout : null
    const newSource = newBlob?.exitCode === 0 ? newBlob.stdout : null

    const totalBytes =
      Buffer.byteLength(patch.stdout) +
      Buffer.byteLength(oldSource ?? '') +
      Buffer.byteLength(newSource ?? '')
    if (totalBytes > MAX_FILE_DIFF_BYTES) return { ok: true, diff: { ...base_, truncated: true } }

    return {
      ok: true,
      diff: { ...base_, hunks: splitPatchIntoFileHunks(patch.stdout), oldSource, newSource },
    }
  }

  /** The worktree contents of one file, or null when it cannot be read as text. */
  async function readWorktreeFile(repositoryPath: string, relativePath: string): Promise<string | null> {
    try {
      return await Bun.file(join(repositoryPath, relativePath)).text()
    } catch {
      return null
    }
  }

  /**
   * Everything uncommitted in a repository: tracked modifications and deletions
   * (`git diff HEAD`, which folds the index and the worktree together) plus
   * untracked files (`git ls-files --others`, since `git diff` never lists files
   * git has not been told about). Tracked and untracked are disjoint by
   * construction — a file cannot be both — so the combined list needs no dedup.
   * The two halves are kept separately as well, because a single file's diff is
   * read one way for a tracked file and another for an untracked one.
   */
  async function collectWorkingChanges(repositoryPath: string) {
    const headResult = await runGit(repositoryPath, ['rev-parse', '--short', '--verify', 'HEAD'])
    const head = headResult.exitCode === 0 ? headResult.stdout.trim() || null : null
    const branchResult = await runGit(repositoryPath, ['symbolic-ref', '--short', '-q', 'HEAD'])
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null

    // No HEAD (a repository with no commits yet) → measure against the empty
    // tree, so every tracked file reads as an addition.
    const baseRevision = head ?? EMPTY_TREE_HASH
    const trackedResult = await runGit(repositoryPath, [...WORKING_SUMMARY_ARGUMENTS, baseRevision, '--'])
    if (trackedResult.exitCode !== 0) {
      return { ok: false as const, detail: trackedResult.stderr.trim() }
    }
    const { files: tracked } = parseCommitFileChanges(trackedResult.stdout)

    const untrackedResult = await runGit(repositoryPath, [...LIST_UNTRACKED_ARGUMENTS])
    const untracked: CommitFileChange[] =
      untrackedResult.exitCode === 0
        ? untrackedResult.stdout
            .split('\0')
            .filter((untrackedPath) => untrackedPath.length > 0)
            .map((untrackedPath) => ({
              path: untrackedPath,
              previousPath: null,
              status: 'added' as const,
              // git reports no line counts for an untracked file without a
              // per-file diff; the numbers surface when its diff is opened.
              additions: null,
              deletions: null,
              binary: false,
            }))
        : []

    const untrackedPaths = new Set(untracked.map((file) => file.path))
    const combined = [...tracked, ...untracked].sort((first, second) =>
      first.path.localeCompare(second.path),
    )
    return {
      ok: true as const,
      head,
      branch,
      baseRevision,
      untrackedPaths,
      files: combined.slice(0, MAX_FILE_CHANGES),
      filesTruncated: combined.length > MAX_FILE_CHANGES,
    }
  }

  /** The uncommitted changes of one listed repository — the working-tree file list. */
  async function readWorkingTree(repositoryRelativePath: string): Promise<ReadWorkingTreeResult> {
    const repository = await resolveRepository(repositoryRelativePath)
    if (!repository) return { ok: false, reason: 'unknown-repository' }

    const changes = await collectWorkingChanges(join(servedRoot, repository.relativePath))
    if (!changes.ok) return { ok: false, reason: 'git-failed', detail: changes.detail }

    return {
      ok: true,
      working: {
        repository: repository.name,
        head: changes.head,
        branch: changes.branch,
        files: changes.files,
        filesTruncated: changes.filesTruncated,
      },
    }
  }

  /**
   * The unified patch for one uncommitted file, plus both complete blobs the
   * patch applies between. `filePath` is validated by **membership** against the
   * working tree's own file listing, exactly as {@link readFileDiff} validates
   * against a commit's. The new side is the worktree file read from disk (that is
   * what "uncommitted" means — the content on disk, past the index); the old side
   * is the HEAD blob, or nothing for an added or untracked file.
   */
  async function readWorkingFileDiff(
    repositoryRelativePath: string,
    filePath: string,
  ): Promise<ReadWorkingFileDiffResult> {
    const repository = await resolveRepository(repositoryRelativePath)
    if (!repository) return { ok: false, reason: 'unknown-repository' }

    const repositoryPath = join(servedRoot, repository.relativePath)
    const changes = await collectWorkingChanges(repositoryPath)
    if (!changes.ok) return { ok: false, reason: 'git-failed', detail: changes.detail }

    const fileChange = changes.files.find(
      (candidate) => candidate.path === filePath || candidate.previousPath === filePath,
    )
    if (!fileChange) return { ok: false, reason: 'unknown-file' }

    // From here on the paths handed to git are git's own strings, not the
    // caller's. The old side of a rename lives at the previous path.
    const newPath = fileChange.path
    const oldPath = fileChange.previousPath ?? fileChange.path
    const isUntracked = changes.untrackedPaths.has(newPath)

    const base: FileDiff = {
      path: newPath,
      previousPath: fileChange.previousPath,
      status: fileChange.status,
      hunks: [],
      oldSource: null,
      newSource: null,
      language: languageForPath(newPath),
      binary: fileChange.binary,
      truncated: false,
    }
    if (fileChange.binary) return { ok: true, diff: base }

    // An untracked file is absent from every tree, so `git diff HEAD` cannot see
    // it — it is diffed from `/dev/null` with `--no-index`, which exits 1 (not 0)
    // precisely when the file has content to show.
    const patch = isUntracked
      ? await runGit(repositoryPath, [...UNTRACKED_FILE_DIFF_ARGUMENTS, '--', '/dev/null', newPath])
      : await runGit(repositoryPath, [
          ...WORKING_FILE_DIFF_ARGUMENTS,
          changes.baseRevision,
          '--',
          ...(fileChange.previousPath !== null ? [oldPath, newPath] : [newPath]),
        ])
    if (isUntracked ? patch.exitCode > NO_INDEX_DIFFERENCES_EXIT_CODE : patch.exitCode !== 0) {
      return { ok: false, reason: 'git-failed', detail: patch.stderr.trim() }
    }

    // A tracked binary is caught up front by its `-` numstat counts, but an
    // untracked one is only revealed here, by git's binary marker in the
    // `--no-index` patch. Return the binary notice rather than reading the file
    // as text (mojibake) and building a line diff from a hunk-less patch.
    if (isUntracked && isBinaryNoIndexPatch(patch.stdout)) {
      return { ok: true, diff: { ...base, binary: true } }
    }

    // No old blob for an added/untracked file, a deleted file has no new blob,
    // and a repository with no HEAD has no old side at all.
    const hasOldSide = !isUntracked && fileChange.status !== 'added' && changes.head !== null
    const hasNewSide = fileChange.status !== 'deleted'
    const [oldBlob, newSource] = await Promise.all([
      hasOldSide ? runGit(repositoryPath, ['show', `HEAD:${oldPath}`]) : null,
      hasNewSide ? readWorktreeFile(repositoryPath, newPath) : null,
    ])
    const oldSource = oldBlob?.exitCode === 0 ? oldBlob.stdout : null

    const totalBytes =
      Buffer.byteLength(patch.stdout) +
      Buffer.byteLength(oldSource ?? '') +
      Buffer.byteLength(newSource ?? '')
    if (totalBytes > MAX_FILE_DIFF_BYTES) return { ok: true, diff: { ...base, truncated: true } }

    return {
      ok: true,
      diff: { ...base, hunks: splitPatchIntoFileHunks(patch.stdout), oldSource, newSource },
    }
  }

  return {
    listRepositories,
    readCommitLog,
    readCommitDetail,
    readFileDiff,
    readBranches,
    readCompareSummary,
    readCompareFileDiff,
    readWorkingTree,
    readWorkingFileDiff,
  }
}

export type GitService = ReturnType<typeof createGitService>
