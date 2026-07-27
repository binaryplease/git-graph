import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitService } from './git'

// Integration test against real git: build a scratch repository with a merged
// feature branch and assert the service returns the parsed, topologically
// ordered commit log the layout algorithm expects.

let scratchRoot: string

function runGit(repositoryPath: string, ...gitArguments: string[]) {
  const result = Bun.spawnSync(
    [
      'git',
      '-C',
      repositoryPath,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      ...gitArguments,
    ],
    { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } },
  )
  if (result.exitCode !== 0) {
    throw new Error(`git ${gitArguments.join(' ')} failed: ${result.stderr.toString()}`)
  }
}

beforeAll(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), 'binp-git-graph-test-'))

  const repositoryPath = join(scratchRoot, 'sample-repo')
  runGit(scratchRoot, 'init', '-b', 'main', repositoryPath)
  runGit(repositoryPath, 'commit', '--allow-empty', '-m', 'root commit')
  runGit(repositoryPath, 'commit', '--allow-empty', '-m', 'second on main')
  runGit(repositoryPath, 'checkout', '-b', 'feature')
  runGit(repositoryPath, 'commit', '--allow-empty', '-m', 'feature work')
  runGit(repositoryPath, 'checkout', 'main')
  runGit(repositoryPath, 'commit', '--allow-empty', '-m', 'third on main')
  runGit(repositoryPath, 'merge', '--no-ff', '-m', 'merge feature', 'feature')
  runGit(repositoryPath, 'tag', 'v1.0')

  runGit(scratchRoot, 'init', '-b', 'main', join(scratchRoot, 'empty-repo'))

  // A second repository with real file content, for the commit-detail tests:
  // a merge that brings in a file, then a rename plus a binary addition.
  const filesRepositoryPath = join(scratchRoot, 'files-repo')
  const writeFile = (fileName: string, contents: string | Uint8Array) =>
    writeFileSync(join(filesRepositoryPath, fileName), contents)
  runGit(scratchRoot, 'init', '-b', 'main', filesRepositoryPath)
  writeFile('a.txt', 'one\n')
  runGit(filesRepositoryPath, 'add', '-A')
  runGit(filesRepositoryPath, 'commit', '-m', 'first commit')
  runGit(filesRepositoryPath, 'checkout', '-b', 'side')
  writeFile('b.txt', 'from the side\n')
  runGit(filesRepositoryPath, 'add', '-A')
  runGit(filesRepositoryPath, 'commit', '-m', 'side commit', '-m', 'A body line.\n\nAnd a second paragraph.')
  runGit(filesRepositoryPath, 'checkout', 'main')
  writeFile('a.txt', 'one\ntwo\n')
  runGit(filesRepositoryPath, 'add', '-A')
  runGit(filesRepositoryPath, 'commit', '-m', 'main commit')
  runGit(filesRepositoryPath, 'merge', '--no-ff', '-m', 'merge side', 'side')
  runGit(filesRepositoryPath, 'mv', 'a.txt', 'renamed.txt')
  writeFile('renamed.txt', 'one\ntwo\nthree\n')
  writeFile('blob.bin', new Uint8Array([0, 1, 2, 3, 0, 255]))
  runGit(filesRepositoryPath, 'rm', '-q', 'b.txt')
  runGit(filesRepositoryPath, 'add', '-A')
  runGit(filesRepositoryPath, 'commit', '-m', 'rename, delete, binary')
  // An unmerged branch, so a three-dot compare against main has something to
  // show (the merged `side` branch does not — it is already an ancestor).
  runGit(filesRepositoryPath, 'checkout', '-b', 'feature-x')
  writeFile('c.txt', 'hello from feature\n')
  runGit(filesRepositoryPath, 'add', '-A')
  runGit(filesRepositoryPath, 'commit', '-m', 'feature-only commit')
  runGit(filesRepositoryPath, 'checkout', 'main')

  // A repository with a dirty working tree, for the uncommitted-changes tests: a
  // committed base, then a modification, a deletion, and an untracked file left
  // uncommitted.
  const dirtyRepositoryPath = join(scratchRoot, 'dirty-repo')
  runGit(scratchRoot, 'init', '-b', 'main', dirtyRepositoryPath)
  writeFileSync(join(dirtyRepositoryPath, 'kept.txt'), 'one\ntwo\n')
  writeFileSync(join(dirtyRepositoryPath, 'gone.txt'), 'delete me\n')
  runGit(dirtyRepositoryPath, 'add', '-A')
  runGit(dirtyRepositoryPath, 'commit', '-m', 'base for the dirty tree')
  writeFileSync(join(dirtyRepositoryPath, 'kept.txt'), 'one\ntwo\nthree\n')
  rmSync(join(dirtyRepositoryPath, 'gone.txt'))
  writeFileSync(join(dirtyRepositoryPath, 'fresh.txt'), 'brand new\nfile\n')
  // An untracked *binary* file: git only reveals its binary-ness when it is
  // diffed (`--numstat` is not run for untracked files up front), so its diff
  // must come back as the binary notice, never a text read of raw bytes.
  writeFileSync(join(dirtyRepositoryPath, 'fresh.bin'), new Uint8Array([0, 1, 2, 3, 0, 255]))
})

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

describe('createGitService', () => {
  test('throws at startup on a nonexistent root', () => {
    expect(() => createGitService({ rootAbsolutePath: '/no/such/place' })).toThrow()
  })

  test('lists repositories that are direct children of the served root', async () => {
    const service = createGitService({ rootAbsolutePath: scratchRoot })
    const { rootPath, repositories } = await service.listRepositories()
    expect(rootPath).toBe(scratchRoot)
    expect(repositories).toEqual([
      { name: 'dirty-repo', relativePath: 'dirty-repo' },
      { name: 'empty-repo', relativePath: 'empty-repo' },
      { name: 'files-repo', relativePath: 'files-repo' },
      { name: 'sample-repo', relativePath: 'sample-repo' },
    ])
  })

  test('lists the served root itself when it is a repository', async () => {
    const service = createGitService({ rootAbsolutePath: join(scratchRoot, 'sample-repo') })
    const { repositories } = await service.listRepositories()
    expect(repositories).toEqual([{ name: 'sample-repo', relativePath: '' }])
  })

  test('reads a parsed, topologically ordered commit log with merge and refs', async () => {
    const service = createGitService({ rootAbsolutePath: scratchRoot })
    const result = await service.readCommitLog('sample-repo', { limit: 100 })
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

    const { commits } = result.log
    expect(commits).toHaveLength(5)

    // Topological order: every commit appears before all of its parents.
    const rowByHash = new Map(commits.map((commit, row) => [commit.hash, row]))
    for (const [row, commit] of commits.entries()) {
      for (const parentHash of commit.parents) {
        expect(rowByHash.get(parentHash)!).toBeGreaterThan(row)
      }
    }

    const mergeCommit = commits[0]!
    expect(mergeCommit.subject).toBe('merge feature')
    expect(mergeCommit.parents).toHaveLength(2)
    expect(mergeCommit.refs).toContain('HEAD -> main')
    expect(mergeCommit.refs).toContain('tag: v1.0')

    const rootCommit = commits.at(-1)!
    expect(rootCommit.subject).toBe('root commit')
    expect(rootCommit.parents).toEqual([])
  })

  test('a repository without commits yields an empty log, not an error', async () => {
    const service = createGitService({ rootAbsolutePath: scratchRoot })
    const result = await service.readCommitLog('empty-repo', { limit: 100 })
    expect(result).toEqual({
      ok: true,
      log: { repository: 'empty-repo', commits: [], truncated: false },
    })
  })

  test('truncates at the requested limit and flags it', async () => {
    const service = createGitService({ rootAbsolutePath: scratchRoot })
    const result = await service.readCommitLog('sample-repo', { limit: 2 })
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.log.commits).toHaveLength(2)
    expect(result.log.truncated).toBe(true)
  })

  test('rejects identifiers that are not in the listing (no path traversal)', async () => {
    const service = createGitService({ rootAbsolutePath: scratchRoot })
    for (const hostileIdentifier of ['../somewhere', 'sample-repo/../..', 'nope']) {
      const result = await service.readCommitLog(hostileIdentifier, { limit: 10 })
      expect(result).toEqual({ ok: false, reason: 'unknown-repository' })
    }
  })
})

describe('readCommitDetail', () => {
  const service = () => createGitService({ rootAbsolutePath: scratchRoot })

  /** Look up a commit of files-repo by subject, the way the UI looks it up by row. */
  async function hashOfCommit(subject: string) {
    const log = await service().readCommitLog('files-repo', { limit: 100 })
    if (!log.ok) throw new Error(`expected ok, got ${log.reason}`)
    const commit = log.log.commits.find((candidate) => candidate.subject === subject)
    if (!commit) throw new Error(`no commit with subject ${subject}`)
    return commit.hash
  }

  test('describes a commit with its metadata, body and changed files', async () => {
    const result = await service().readCommitDetail('files-repo', await hashOfCommit('side commit'))
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

    const { detail } = result
    expect(detail.fullHash).toMatch(/^[0-9a-f]{40}$/)
    expect(detail.hash).toBe(detail.fullHash.slice(0, detail.hash.length))
    expect(detail.parents).toHaveLength(1)
    expect(detail.author).toBe('Test')
    expect(detail.authorEmail).toBe('test@example.invalid')
    expect(detail.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(detail.subject).toBe('side commit')
    expect(detail.body).toBe('A body line.\n\nAnd a second paragraph.')
    expect(detail.filesTruncated).toBe(false)
    expect(detail.files).toEqual([
      { path: 'b.txt', previousPath: null, status: 'added', additions: 1, deletions: 0, binary: false },
    ])
  })

  test('shows what a merge brought in, diffing against the first parent', async () => {
    const result = await service().readCommitDetail('files-repo', await hashOfCommit('merge side'))
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.detail.parents).toHaveLength(2)
    expect(result.detail.files.map((file) => file.path)).toEqual(['b.txt'])
  })

  test('reports renames, deletions and binaries', async () => {
    const result = await service().readCommitDetail(
      'files-repo',
      await hashOfCommit('rename, delete, binary'),
    )
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

    const byPath = new Map(result.detail.files.map((file) => [file.path, file]))
    expect(byPath.get('renamed.txt')).toEqual({
      path: 'renamed.txt',
      previousPath: 'a.txt',
      status: 'renamed',
      additions: 1,
      deletions: 0,
      binary: false,
    })
    expect(byPath.get('b.txt')!.status).toBe('deleted')
    expect(byPath.get('blob.bin')).toEqual({
      path: 'blob.bin',
      previousPath: null,
      status: 'added',
      additions: null,
      deletions: null,
      binary: true,
    })
  })

  test('carries the refs pointing at the commit', async () => {
    const result = await service().readCommitDetail(
      'files-repo',
      await hashOfCommit('rename, delete, binary'),
    )
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.detail.refs).toContain('HEAD -> main')
  })

  test('reports a root commit as parentless', async () => {
    const result = await service().readCommitDetail('files-repo', await hashOfCommit('first commit'))
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.detail.parents).toEqual([])
  })

  test('rejects a hash that is not hexadecimal before reaching git', async () => {
    for (const hostileHash of ['--upload-pack=touch /tmp/pwned', '../../etc/passwd', 'HEAD', '']) {
      expect(await service().readCommitDetail('files-repo', hostileHash)).toEqual({
        ok: false,
        reason: 'invalid-hash',
      })
    }
  })

  test('reports an unknown commit and an unknown repository distinctly', async () => {
    expect(await service().readCommitDetail('files-repo', 'deadbeef')).toEqual({
      ok: false,
      reason: 'unknown-commit',
    })
    expect(await service().readCommitDetail('nope', 'deadbeef')).toEqual({
      ok: false,
      reason: 'unknown-repository',
    })
  })
})

describe('readFileDiff', () => {
  const service = () => createGitService({ rootAbsolutePath: scratchRoot })

  async function hashOfCommit(subject: string) {
    const log = await service().readCommitLog('files-repo', { limit: 100 })
    if (!log.ok) throw new Error(`expected ok, got ${log.reason}`)
    const commit = log.log.commits.find((candidate) => candidate.subject === subject)
    if (!commit) throw new Error(`no commit with subject ${subject}`)
    return commit.hash
  }

  async function diffOf(subject: string, filePath: string) {
    const result = await service().readFileDiff('files-repo', await hashOfCommit(subject), filePath)
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    return result.diff
  }

  test('returns the patch and both complete blobs for a modified file', async () => {
    const diff = await diffOf('main commit', 'a.txt')
    expect(diff.status).toBe('modified')
    expect(diff.oldSource).toBe('one\n')
    expect(diff.newSource).toBe('one\ntwo\n')
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0]).toContain('+two')
    expect(diff.language).toBe('txt')
    expect(diff.binary).toBe(false)
    expect(diff.truncated).toBe(false)
  })

  test('an added file on a root commit has no old side and does not error', async () => {
    const diff = await diffOf('first commit', 'a.txt')
    expect(diff.status).toBe('added')
    expect(diff.oldSource).toBeNull()
    expect(diff.newSource).toBe('one\n')
    expect(diff.hunks[0]).toContain('new file mode')
  })

  test('a deleted file has no new side', async () => {
    const diff = await diffOf('rename, delete, binary', 'b.txt')
    expect(diff.status).toBe('deleted')
    expect(diff.oldSource).toBe('from the side\n')
    expect(diff.newSource).toBeNull()
  })

  test('a rename reads the old side at the previous path', async () => {
    const diff = await diffOf('rename, delete, binary', 'renamed.txt')
    expect(diff.status).toBe('renamed')
    expect(diff.previousPath).toBe('a.txt')
    expect(diff.oldSource).toBe('one\ntwo\n')
    expect(diff.newSource).toBe('one\ntwo\nthree\n')
  })

  test('a rename can also be requested by its previous path', async () => {
    const diff = await diffOf('rename, delete, binary', 'a.txt')
    expect(diff.path).toBe('renamed.txt')
    expect(diff.previousPath).toBe('a.txt')
  })

  test('a binary file carries no patch and no sources', async () => {
    const diff = await diffOf('rename, delete, binary', 'blob.bin')
    expect(diff.binary).toBe(true)
    expect(diff.hunks).toEqual([])
    expect(diff.oldSource).toBeNull()
    expect(diff.newSource).toBeNull()
  })

  test('a merge diffs against the first parent, matching the commit endpoint', async () => {
    const diff = await diffOf('merge side', 'b.txt')
    expect(diff.status).toBe('added')
    expect(diff.newSource).toBe('from the side\n')
    expect(diff.hunks[0]).toContain('+from the side')
  })

  test('rejects a path the commit does not touch (the membership guard)', async () => {
    const commitHash = await hashOfCommit('main commit')
    for (const outsidePath of [
      'b.txt', // exists in the repository, but not in this commit
      '../../etc/passwd',
      '.git/config',
      '--output=/tmp/pwned',
      'a.txt ',
    ]) {
      expect(await service().readFileDiff('files-repo', commitHash, outsidePath)).toEqual({
        ok: false,
        reason: 'unknown-file',
      })
    }
  })

  test('rejects a bad hash and an unknown repository before reaching git', async () => {
    expect(await service().readFileDiff('files-repo', 'HEAD', 'a.txt')).toEqual({
      ok: false,
      reason: 'invalid-hash',
    })
    expect(await service().readFileDiff('nope', 'deadbeef', 'a.txt')).toEqual({
      ok: false,
      reason: 'unknown-repository',
    })
  })
})

describe('readBranches', () => {
  const service = () => createGitService({ rootAbsolutePath: scratchRoot })

  test('lists local branches with the default flagged and sorted first', async () => {
    const result = await service().readBranches('files-repo')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.branches.repository).toBe('files-repo')
    expect(result.branches.defaultBranch).toBe('main')
    // Default first, then alphabetical; the checked-out branch is flagged.
    expect(result.branches.branches).toEqual([
      { name: 'main', isDefault: true, isCurrent: true },
      { name: 'feature-x', isDefault: false, isCurrent: false },
      { name: 'side', isDefault: false, isCurrent: false },
    ])
  })

  test('an unknown repository is rejected, not path-traversed', async () => {
    expect(await service().readBranches('../elsewhere')).toEqual({
      ok: false,
      reason: 'unknown-repository',
    })
  })
})

describe('readCompareSummary', () => {
  const service = () => createGitService({ rootAbsolutePath: scratchRoot })

  test('shows what a branch adds relative to its merge base with the default', async () => {
    // feature-x branched off main's tip and added c.txt. A three-dot compare
    // shows only that, and an omitted base resolves to the default branch (main).
    const result = await service().readCompareSummary('files-repo', 'feature-x', '')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.summary.base).toBe('main')
    expect(result.summary.head).toBe('feature-x')
    expect(result.summary.mergeBase).toMatch(/^[0-9a-f]+$/)
    expect(result.summary.files).toEqual([
      { path: 'c.txt', previousPath: null, status: 'added', additions: 1, deletions: 0, binary: false },
    ])
  })

  test('a branch already merged into the base shows no changes', async () => {
    // side was merged into main, so it is an ancestor — a three-dot compare is
    // empty, which is the correct "this branch adds nothing new" answer.
    const result = await service().readCompareSummary('files-repo', 'side', 'main')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.summary.files).toEqual([])
  })

  test('rejects a branch that is not in the listing, and an unknown repository', async () => {
    expect(await service().readCompareSummary('files-repo', 'nope', '')).toMatchObject({
      ok: false,
      reason: 'unknown-ref',
    })
    expect(await service().readCompareSummary('files-repo', 'feature-x', 'also-nope')).toMatchObject({
      ok: false,
      reason: 'unknown-ref',
    })
    // A hostile ref never reaches git — membership rejects it as an unknown ref.
    expect(await service().readCompareSummary('files-repo', '--output=/tmp/pwned', 'main')).toMatchObject({
      ok: false,
      reason: 'unknown-ref',
    })
    expect(await service().readCompareSummary('nope', 'feature-x', 'main')).toEqual({
      ok: false,
      reason: 'unknown-repository',
    })
  })
})

describe('readCompareFileDiff', () => {
  const service = () => createGitService({ rootAbsolutePath: scratchRoot })

  test('returns the file’s patch and blobs across the merge-base comparison', async () => {
    const result = await service().readCompareFileDiff('files-repo', 'feature-x', '', 'c.txt')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.diff.status).toBe('added')
    expect(result.diff.oldSource).toBeNull()
    expect(result.diff.newSource).toBe('hello from feature\n')
    expect(result.diff.hunks[0]).toContain('+hello from feature')
  })

  test('rejects a path the comparison does not touch', async () => {
    for (const outsidePath of ['a.txt', '../../etc/passwd', '.git/config']) {
      expect(await service().readCompareFileDiff('files-repo', 'feature-x', '', outsidePath)).toMatchObject({
        ok: false,
        reason: 'unknown-file',
      })
    }
  })

  test('rejects an unknown branch before reaching a file', async () => {
    expect(await service().readCompareFileDiff('files-repo', 'nope', '', 'c.txt')).toMatchObject({
      ok: false,
      reason: 'unknown-ref',
    })
  })
})

describe('readWorkingTree', () => {
  const service = () => createGitService({ rootAbsolutePath: scratchRoot })

  test('lists modified, deleted, and untracked files, sorted by path', async () => {
    const result = await service().readWorkingTree('dirty-repo')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.working.branch).toBe('main')
    expect(result.working.head).not.toBeNull()
    expect(result.working.files.map((file) => file.path)).toEqual([
      'fresh.bin',
      'fresh.txt',
      'gone.txt',
      'kept.txt',
    ])
    const byPath = Object.fromEntries(result.working.files.map((file) => [file.path, file]))
    expect(byPath['kept.txt']?.status).toBe('modified')
    expect(byPath['gone.txt']?.status).toBe('deleted')
    expect(byPath['fresh.txt']?.status).toBe('added')
    expect(byPath['fresh.bin']?.status).toBe('added')
    expect(result.working.filesTruncated).toBe(false)
  })

  test('reports a clean working tree as an empty file list', async () => {
    const result = await service().readWorkingTree('sample-repo')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.working.files).toEqual([])
  })

  test('rejects an unknown repository', async () => {
    expect(await service().readWorkingTree('no-such-repo')).toMatchObject({
      ok: false,
      reason: 'unknown-repository',
    })
  })
})

describe('readWorkingFileDiff', () => {
  const service = () => createGitService({ rootAbsolutePath: scratchRoot })

  test('diffs a modified file: HEAD blob on the old side, worktree content on the new', async () => {
    const result = await service().readWorkingFileDiff('dirty-repo', 'kept.txt')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.diff.status).toBe('modified')
    expect(result.diff.oldSource).toBe('one\ntwo\n')
    expect(result.diff.newSource).toBe('one\ntwo\nthree\n')
    expect(result.diff.hunks[0]).toContain('+three')
  })

  test('diffs an untracked file as a full addition', async () => {
    const result = await service().readWorkingFileDiff('dirty-repo', 'fresh.txt')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.diff.status).toBe('added')
    expect(result.diff.oldSource).toBeNull()
    expect(result.diff.newSource).toBe('brand new\nfile\n')
    expect(result.diff.hunks[0]).toContain('+brand new')
  })

  test('diffs a deleted file: HEAD blob on the old side, nothing on the new', async () => {
    const result = await service().readWorkingFileDiff('dirty-repo', 'gone.txt')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.diff.status).toBe('deleted')
    expect(result.diff.oldSource).toBe('delete me\n')
    expect(result.diff.newSource).toBeNull()
  })

  test('reports an untracked binary file as binary, never a text read of its bytes', async () => {
    const result = await service().readWorkingFileDiff('dirty-repo', 'fresh.bin')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.diff.binary).toBe(true)
    expect(result.diff.hunks).toEqual([])
    expect(result.diff.oldSource).toBeNull()
    expect(result.diff.newSource).toBeNull()
  })

  test('rejects a path the working tree does not touch', async () => {
    for (const outsidePath of ['kept-but-clean.txt', '../../etc/passwd', '.git/config']) {
      expect(await service().readWorkingFileDiff('dirty-repo', outsidePath)).toMatchObject({
        ok: false,
        reason: 'unknown-file',
      })
    }
  })

  test('rejects an unknown repository before reaching a file', async () => {
    expect(await service().readWorkingFileDiff('no-such-repo', 'kept.txt')).toMatchObject({
      ok: false,
      reason: 'unknown-repository',
    })
  })
})
