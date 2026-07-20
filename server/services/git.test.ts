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
