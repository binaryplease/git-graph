import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { groupRefDecorations } from '../../shared/refGroup'
import { createGitService } from './git'
import { createListedRepositorySet, createServedRootRepositorySet } from './repository-set'

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
  scratchRoot = mkdtempSync(join(tmpdir(), 'git-graph-test-'))

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

  // A repository with remote-tracking refs, for the ref-pill grouping: `main` is
  // in sync with two remotes, `origin/published` has no local branch at all, and
  // `local-only` never left this machine. The refs are written directly rather
  // than fetched — `update-ref` produces exactly the refs/remotes layout a fetch
  // would, without needing a second repository to fetch from.
  const remotesRepositoryPath = join(scratchRoot, 'remotes-repo')
  runGit(scratchRoot, 'init', '-b', 'main', remotesRepositoryPath)
  runGit(remotesRepositoryPath, 'commit', '--allow-empty', '-m', 'shared commit')
  runGit(remotesRepositoryPath, 'branch', 'local-only')
  runGit(remotesRepositoryPath, 'remote', 'add', 'origin', 'https://example.invalid/repo.git')
  runGit(remotesRepositoryPath, 'remote', 'add', 'upstream', 'https://example.invalid/up.git')
  runGit(remotesRepositoryPath, 'update-ref', 'refs/remotes/origin/main', 'main')
  runGit(remotesRepositoryPath, 'update-ref', 'refs/remotes/upstream/main', 'main')
  runGit(remotesRepositoryPath, 'update-ref', 'refs/remotes/origin/published', 'main')
  // A user's `log.decorate=full` makes `%d`/`%D` print `refs/heads/main` and
  // `refs/remotes/origin/main` unless the short form is pinned on the command
  // line — and every decoration test on this fixture assumes the short form.
  runGit(remotesRepositoryPath, 'config', 'log.decorate', 'full')

  // The two shapes that break a structural read of `refs/remotes`, which is why
  // the remote names are read from `git remote` and only *filtered* by the refs:
  //
  //   - `fork/alice` is a remote whose own name contains a slash (git accepts
  //     it). `refs/remotes/fork/alice/main` cannot be split back into that
  //     remote and the branch `main` without being told the name.
  //   - `unfetched` is configured but has no refs, so it can never appear in a
  //     decoration and must not be offered as a name to classify against.
  //   - `fork` is configured (by hand — `git remote add` refuses a name that
  //     nests another, but the config is accepted and listed) and has no refs
  //     of its own; `fork/alice`'s refs start with `refs/remotes/fork/` all the
  //     same, and must not count for it.
  const slashRemoteRepositoryPath = join(scratchRoot, 'slash-remote-repo')
  runGit(scratchRoot, 'init', '-b', 'main', slashRemoteRepositoryPath)
  runGit(slashRemoteRepositoryPath, 'commit', '--allow-empty', '-m', 'shared commit')
  runGit(slashRemoteRepositoryPath, 'remote', 'add', 'fork/alice', 'https://example.invalid/a.git')
  runGit(slashRemoteRepositoryPath, 'remote', 'add', 'unfetched', 'https://example.invalid/u.git')
  runGit(slashRemoteRepositoryPath, 'config', 'remote.fork.url', 'https://example.invalid/f.git')
  runGit(slashRemoteRepositoryPath, 'update-ref', 'refs/remotes/fork/alice/main', 'main')

  // A repository where local branches collide with remote-tracking refs of the
  // same name. git's ref *shortening* disambiguates the remote one as
  // `remotes/origin/main` and the local one as `heads/origin/main`, so every
  // `%(refname:short)` read in the service was wrong in its own way: the remote
  // reader reported a remote named `remotes` and lost `origin`, the branch
  // listing named a branch no decoration prints, and `origin/HEAD` — pointed at
  // the colliding `origin/trunk` here, so the default is `trunk` only if it is
  // resolved right and `main` if the heuristic silently takes over — shortened
  // to a name the `origin/` strip could not undo.
  const ambiguousRemoteRepositoryPath = join(scratchRoot, 'ambiguous-remote-repo')
  runGit(scratchRoot, 'init', '-b', 'main', ambiguousRemoteRepositoryPath)
  runGit(ambiguousRemoteRepositoryPath, 'commit', '--allow-empty', '-m', 'shared commit')
  runGit(ambiguousRemoteRepositoryPath, 'remote', 'add', 'origin', 'https://example.invalid/r.git')
  runGit(ambiguousRemoteRepositoryPath, 'update-ref', 'refs/remotes/origin/main', 'main')
  runGit(ambiguousRemoteRepositoryPath, 'update-ref', 'refs/remotes/origin/trunk', 'main')
  runGit(ambiguousRemoteRepositoryPath, 'branch', 'origin/main')
  runGit(ambiguousRemoteRepositoryPath, 'branch', 'origin/trunk')
  runGit(ambiguousRemoteRepositoryPath, 'branch', 'trunk')
  runGit(ambiguousRemoteRepositoryPath, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')

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
    expect(() => createGitService({ repositories: createServedRootRepositorySet('/no/such/place') })).toThrow()
  })

  test('lists repositories that are direct children of the served root', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    const { rootPath, repositories } = await service.listRepositories()
    expect(rootPath).toBe(scratchRoot)
    expect(repositories).toEqual([
      { name: 'ambiguous-remote-repo', relativePath: 'ambiguous-remote-repo' },
      { name: 'dirty-repo', relativePath: 'dirty-repo' },
      { name: 'empty-repo', relativePath: 'empty-repo' },
      { name: 'files-repo', relativePath: 'files-repo' },
      { name: 'remotes-repo', relativePath: 'remotes-repo' },
      { name: 'sample-repo', relativePath: 'sample-repo' },
      { name: 'slash-remote-repo', relativePath: 'slash-remote-repo' },
    ])
  })

  test('lists the served root itself when it is a repository', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(join(scratchRoot, 'sample-repo')) })
    const { repositories } = await service.listRepositories()
    expect(repositories).toEqual([{ name: 'sample-repo', relativePath: '' }])
  })

  // A repositories file (GIT_GRAPH_REPOSITORIES_FILE): the identifier is the
  // absolute path, and the file — not the directory layout — is the membership.
  test('serves exactly the repositories a repositories file names, by absolute path', async () => {
    const listDirectory = mkdtempSync(join(tmpdir(), 'git-graph-listed-'))
    try {
      const listFile = join(listDirectory, 'repositories')
      const samplePath = join(scratchRoot, 'sample-repo')
      const outsidePath = join(scratchRoot, 'files-repo')
      writeFileSync(listFile, `${samplePath}\n`)
      const service = createGitService({ repositories: createListedRepositorySet(listFile) })

      expect(await service.listRepositories()).toEqual({
        rootPath: null,
        repositories: [{ name: 'sample-repo', relativePath: samplePath }],
      })
      const log = await service.readCommitLog(samplePath, { limit: 10 })
      expect(log.ok && log.log.repository).toBe('sample-repo')

      // A sibling on disk the file does not name, the root-relative form of the
      // named one, and a traversal back to it are all outside the set.
      for (const identifier of [outsidePath, 'sample-repo', '', `${outsidePath}/../sample-repo`]) {
        const refused = await service.readCommitLog(identifier, { limit: 10 })
        expect(refused).toEqual({ ok: false, reason: 'unknown-repository' })
      }
      // `feature-x` exists there, so a checkout that slipped past membership
      // would move HEAD off `main`.
      const symbolicHead = () => Bun.spawnSync(['git', '-C', outsidePath, 'symbolic-ref', 'HEAD']).stdout.toString().trim()
      expect(symbolicHead()).toBe('refs/heads/main')
      const checkout = await service.checkout(outsidePath, { kind: 'branch', name: 'feature-x' })
      expect(checkout).toEqual({ ok: false, reason: 'unknown-repository' })
      expect(symbolicHead()).toBe('refs/heads/main')
    } finally {
      rmSync(listDirectory, { recursive: true, force: true })
    }
  })

  test('reads a parsed, topologically ordered commit log with merge and refs', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
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
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    const result = await service.readCommitLog('empty-repo', { limit: 100 })
    expect(result).toEqual({
      ok: true,
      log: { repository: 'empty-repo', commits: [], remotes: [], truncated: false },
    })
  })

  test('truncates at the requested limit and flags it', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    const result = await service.readCommitLog('sample-repo', { limit: 2 })
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.log.commits).toHaveLength(2)
    expect(result.log.truncated).toBe(true)
  })

  test('rejects identifiers that are not in the listing (no path traversal)', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    for (const hostileIdentifier of ['../somewhere', 'sample-repo/../..', 'nope']) {
      const result = await service.readCommitLog(hostileIdentifier, { limit: 10 })
      expect(result).toEqual({ ok: false, reason: 'unknown-repository' })
    }
  })

  test('reports the repository’s remote names alongside the log', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    const result = await service.readCommitLog('remotes-repo', { limit: 100 })
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.log.remotes).toEqual(['origin', 'upstream'])
    // A repository with no remote-tracking refs reports none, rather than
    // guessing that `origin` exists.
    const withoutRemotes = await service.readCommitLog('sample-repo', { limit: 100 })
    if (!withoutRemotes.ok) throw new Error(`expected ok, got ${withoutRemotes.reason}`)
    expect(withoutRemotes.log.remotes).toEqual([])
  })

  test('real decorations plus the remote names group into one ref pill per ref', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    const result = await service.readCommitLog('remotes-repo', { limit: 100 })
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

    const commit = result.log.commits[0]!
    // git decorates the single commit with every ref that points at it.
    expect(commit.refs).toContain('HEAD -> main')
    expect(commit.refs).toContain('origin/main')
    expect(commit.refs).toContain('upstream/main')
    expect(commit.refs).toContain('origin/published')
    expect(commit.refs).toContain('local-only')

    // Five decorations, three refs: `main` swallows both of its remotes, and
    // neither the local-only branch nor the remote-only one is touched. (Compared
    // as a set — the order git lists decorations in is git's business.)
    const groups = groupRefDecorations(commit.refs, result.log.remotes)
    const described = groups.map((group) => ({
      kind: group.kind,
      name: group.name,
      remotes: group.remotes,
    }))
    expect(described).toHaveLength(3)
    expect(described).toContainEqual({ kind: 'branch', name: 'main', remotes: ['origin', 'upstream'] })
    expect(described).toContainEqual({ kind: 'branch', name: 'local-only', remotes: [] })
    expect(described).toContainEqual({ kind: 'remote', name: 'published', remotes: ['origin'] })
  })

  // Regression: the reader used to derive a remote name structurally, by cutting
  // a `%(refname:short)` listing at its first slash. That cannot express what a
  // remote name actually is, and the grouper — which matches names longest-first
  // precisely so a slash-named remote works — was left unable to receive one.
  test('a slash-named remote is reported whole, and an unfetched one not at all', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    const result = await service.readCommitLog('slash-remote-repo', { limit: 100 })
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    // Not `fork`: that would split the ref into a remote and a branch
    // `alice/main`, neither of which exists — and it is configured, with no refs
    // of its own, so a plain prefix test would admit it on `fork/alice`'s refs.
    // And not `unfetched`: configured, but with no refs it can never appear in
    // a decoration.
    expect(result.log.remotes).toEqual(['fork/alice'])

    // End to end: with the right name, the branch and its remote unify into one
    // pill instead of standing as two.
    const commit = result.log.commits[0]!
    expect(commit.refs).toContain('fork/alice/main')
    const groups = groupRefDecorations(commit.refs, result.log.remotes)
    expect(groups.map((group) => [group.kind, group.name, group.remotes])).toEqual([
      ['branch', 'main', ['fork/alice']],
    ])
  })

  // Regression: git shortens `refs/remotes/origin/main` to `remotes/origin/main`
  // when a local `origin/main` would make the short form ambiguous. Cutting that
  // at the first slash reported a remote named `remotes` and dropped `origin`.
  test('a local branch colliding with a remote-tracking ref does not forge a remote named `remotes`', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    const result = await service.readCommitLog('ambiguous-remote-repo', { limit: 100 })
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.log.remotes).toEqual(['origin'])
    expect(result.log.remotes).not.toContain('remotes')
  })

  // Regression: `%d` honours `log.decorate`, and the grouper is written against
  // the short form. The fixture sets `log.decorate=full`; the short form has to
  // be pinned on the command line for these to come back as anything the pills
  // can classify.
  test('decorations arrive short whatever `log.decorate` says', async () => {
    const service = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    const result = await service.readCommitLog('remotes-repo', { limit: 100 })
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    const commit = result.log.commits[0]!
    expect(commit.refs).toContain('HEAD -> main')
    expect(commit.refs).toContain('origin/main')
    expect(commit.refs.some((ref) => ref.includes('refs/'))).toBe(false)
  })
})

describe('readCommitDetail', () => {
  const service = () => createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })

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
    expect(result.detail.remotes).toEqual([])
  })

  test('carries the remote names too, so a standalone commit tab can group the refs', async () => {
    const detailService = createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
    const log = await detailService.readCommitLog('remotes-repo', { limit: 10 })
    if (!log.ok) throw new Error(`expected ok, got ${log.reason}`)
    const result = await detailService.readCommitDetail('remotes-repo', log.log.commits[0]!.hash)
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.detail.remotes).toEqual(['origin', 'upstream'])
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
  const service = () => createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })

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
  const service = () => createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })

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

  // Regression: the listing read `%(refname:short)`, which names the local
  // `origin/main` here `heads/origin/main` — so the compare link the pill builds
  // for it failed the membership guard against this very listing — and the
  // default was resolved from `symbolic-ref --short`, whose `remotes/origin/trunk`
  // an `origin/` strip cannot undo, so it fell through to `main`.
  test('branch names and the default survive a local/remote name collision', async () => {
    const result = await service().readBranches('ambiguous-remote-repo')
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
    expect(result.branches.defaultBranch).toBe('trunk')
    expect(result.branches.branches).toEqual([
      { name: 'trunk', isDefault: true, isCurrent: false },
      { name: 'main', isDefault: false, isCurrent: true },
      { name: 'origin/main', isDefault: false, isCurrent: false },
      { name: 'origin/trunk', isDefault: false, isCurrent: false },
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
  const service = () => createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })

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
  const service = () => createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })

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
  const service = () => createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })

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
  const service = () => createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })

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

// The first write. Each test builds its own repository, because a checkout
// changes the state the next test would start from. What is pinned: each target
// kind lands HEAD where it should, every target git's own listings do not name is
// refused *before* git runs (HEAD untouched afterwards), and git's refusal of a
// switch over uncommitted changes comes back with git's stderr, the changes
// intact.
describe('checkout', () => {
  const service = () => createGitService({ repositories: createServedRootRepositorySet(scratchRoot) })
  let fixtureCount = 0

  const gitOutput = (repositoryPath: string, ...gitArguments: string[]) =>
    Bun.spawnSync(['git', '-C', repositoryPath, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...gitArguments], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    })
      .stdout.toString()
      .trim()

  /**
   * `main` (checked out) one commit past `base`, which carries the annotated tag
   * `v1`; `feature` changes `tracked.txt` off `base`; `twin` is both a branch (at
   * main) and a tag (at base), so a tag checkout that resolved the short name
   * would land on the wrong commit; `origin/published` exists only as a
   * remote-tracking ref; and `dangling` is a commit no ref or HEAD reaches.
   */
  function createCheckoutFixture() {
    fixtureCount += 1
    const repositoryName = `checkout-repo-${fixtureCount}`
    const repositoryPath = join(scratchRoot, repositoryName)
    runGit(scratchRoot, 'init', '-b', 'main', repositoryPath)
    writeFileSync(join(repositoryPath, 'tracked.txt'), 'base\n')
    runGit(repositoryPath, 'add', '-A')
    runGit(repositoryPath, 'commit', '-m', 'base')
    runGit(repositoryPath, 'tag', '-a', '-m', 'first release', 'v1')
    runGit(repositoryPath, 'tag', 'twin')
    runGit(repositoryPath, 'checkout', '-b', 'feature')
    writeFileSync(join(repositoryPath, 'tracked.txt'), 'feature\n')
    runGit(repositoryPath, 'commit', '-am', 'feature change')
    runGit(repositoryPath, 'checkout', 'main')
    runGit(repositoryPath, 'commit', '--allow-empty', '-m', 'main second')
    runGit(repositoryPath, 'branch', 'twin')
    runGit(repositoryPath, 'remote', 'add', 'origin', 'https://example.invalid/c.git')
    runGit(repositoryPath, 'update-ref', 'refs/remotes/origin/published', 'feature')
    const dangling = gitOutput(repositoryPath, 'commit-tree', 'HEAD^{tree}', '-m', 'dangling')
    return {
      repositoryName,
      repositoryPath,
      dangling,
      fullHashOf: (revision: string) => gitOutput(repositoryPath, 'rev-parse', `${revision}^{commit}`),
      currentBranch: () => gitOutput(repositoryPath, 'branch', '--show-current'),
      headHash: () => gitOutput(repositoryPath, 'rev-parse', 'HEAD'),
    }
  }

  test('checks out a local branch: HEAD follows it', async () => {
    const fixture = createCheckoutFixture()
    const outcome = await service().checkout(fixture.repositoryName, { kind: 'branch', name: 'feature' })
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}: ${outcome.detail}`)
    expect(outcome.result.branch).toBe('feature')
    expect(fixture.fullHashOf('feature').startsWith(outcome.result.head)).toBe(true)
    expect(outcome.result.message).toBe("Switched to branch 'feature'")
    expect(fixture.currentBranch()).toBe('feature')
  })

  test('checks out a tag by its full refname: HEAD detaches at the tagged commit, not a same-named branch', async () => {
    const fixture = createCheckoutFixture()
    const annotated = await service().checkout(fixture.repositoryName, { kind: 'tag', name: 'v1' })
    if (!annotated.ok) throw new Error(`expected ok, got ${annotated.reason}: ${annotated.detail}`)
    expect(annotated.result.branch).toBeNull()
    expect(fixture.headHash()).toBe(fixture.fullHashOf('v1'))
    // One line of git's report, not the multi-line detached-HEAD advice.
    expect(annotated.result.message).toStartWith('HEAD is now at')

    const twin = await service().checkout(fixture.repositoryName, { kind: 'tag', name: 'twin' })
    expect(twin.ok).toBe(true)
    expect(fixture.headHash()).toBe(fixture.fullHashOf('refs/tags/twin'))
    expect(fixture.headHash()).not.toBe(fixture.fullHashOf('refs/heads/twin'))
  })

  test('checks out a commit by full or abbreviated hash: HEAD detaches there', async () => {
    const fixture = createCheckoutFixture()
    const featureHash = fixture.fullHashOf('feature')
    const full = await service().checkout(fixture.repositoryName, { kind: 'commit', hash: featureHash })
    if (!full.ok) throw new Error(`expected ok, got ${full.reason}: ${full.detail}`)
    expect(full.result.branch).toBeNull()
    expect(fixture.headHash()).toBe(featureHash)

    const baseHash = fixture.fullHashOf('v1')
    const abbreviated = await service().checkout(fixture.repositoryName, {
      kind: 'commit',
      hash: baseHash.slice(0, 10).toUpperCase(),
    })
    expect(abbreviated.ok).toBe(true)
    expect(fixture.headHash()).toBe(baseHash)
  })

  test('refuses every target git’s own listings do not name, before git runs', async () => {
    const fixture = createCheckoutFixture()
    const headBefore = fixture.headHash()
    const refused = [
      [{ kind: 'branch', name: 'nope' }, 'unknown-ref'],
      // Only a remote-tracking ref: never guessed into a new tracking branch.
      [{ kind: 'branch', name: 'published' }, 'unknown-ref'],
      [{ kind: 'branch', name: 'origin/published' }, 'unknown-ref'],
      // A tag is not a branch, and a branch is not a tag.
      [{ kind: 'branch', name: 'v1' }, 'unknown-ref'],
      [{ kind: 'tag', name: 'feature' }, 'unknown-ref'],
      // Option- and revision-shaped strings are simply not in the listing.
      [{ kind: 'branch', name: '--orphan=evil' }, 'unknown-ref'],
      [{ kind: 'branch', name: 'main~1' }, 'unknown-ref'],
      [{ kind: 'tag', name: '../heads/main' }, 'unknown-ref'],
      // A real commit object that no ref or HEAD reaches is outside the history.
      [{ kind: 'commit', hash: fixture.dangling }, 'unknown-commit'],
      [{ kind: 'commit', hash: 'ffffffffff' }, 'unknown-commit'],
      [{ kind: 'commit', hash: 'HEAD~1' }, 'invalid-hash'],
    ] as const
    for (const [target, reason] of refused) {
      expect(await service().checkout(fixture.repositoryName, target)).toMatchObject({ ok: false, reason })
    }
    expect(await service().checkout('../escape', { kind: 'branch', name: 'main' })).toMatchObject({
      ok: false,
      reason: 'unknown-repository',
    })
    expect(fixture.headHash()).toBe(headBefore)
    expect(fixture.currentBranch()).toBe('main')
  })

  test('surfaces git’s refusal to overwrite uncommitted changes, leaving them intact', async () => {
    const fixture = createCheckoutFixture()
    writeFileSync(join(fixture.repositoryPath, 'tracked.txt'), 'uncommitted work\n')
    const outcome = await service().checkout(fixture.repositoryName, { kind: 'branch', name: 'feature' })
    expect(outcome).toMatchObject({ ok: false, reason: 'checkout-refused' })
    if (outcome.ok) return
    expect(outcome.detail).toContain('would be overwritten by checkout')
    expect(outcome.detail).toContain('tracked.txt')
    expect(fixture.currentBranch()).toBe('main')
    expect(await Bun.file(join(fixture.repositoryPath, 'tracked.txt')).text()).toBe('uncommitted work\n')
  })
})
