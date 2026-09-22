import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createListedRepositorySet, createServedRootRepositorySet, parseRepositoriesFile } from './repository-set'

// Which repositories are served is the membership every repository identifier
// is resolved against. The explicit list is what lets a host name repositories
// anywhere on disk, so what is pinned is that it serves exactly what it names.

describe('parseRepositoriesFile', () => {
  test('one absolute path per line; blanks and # comments ignored; normalised and de-duplicated', () => {
    expect(parseRepositoriesFile('# projects\n/home/me/one\n\n  /home/me/two/  \n/home/me/./one\n/tmp/x/../y\n')).toEqual({
      ok: true,
      paths: ['/home/me/one', '/home/me/two', '/tmp/y'],
    })
    expect(parseRepositoriesFile('')).toEqual({ ok: true, paths: [] })
  })

  test('one relative path refuses the whole file, naming the line', () => {
    const parsed = parseRepositoriesFile('/home/me/one\nsibling\n')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toContain('line 2')
    expect(parseRepositoriesFile('~/Developer/x').ok).toBe(false)
  })
})

describe('createListedRepositorySet', () => {
  let scratch: string
  let listFile: string
  const repository = (name: string) => {
    const path = join(scratch, name)
    mkdirSync(join(path, '.git'), { recursive: true })
    return path
  }

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'git-graph-repository-set-'))
    listFile = join(scratch, 'repositories')
  })
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  test('refuses to start on a missing or malformed file', () => {
    expect(() => createListedRepositorySet(join(scratch, 'absent'))).toThrow('cannot be read')
    writeFileSync(listFile, 'relative/path\n')
    expect(() => createListedRepositorySet(listFile)).toThrow('not an absolute path')
  })

  test('serves exactly the named repositories, by absolute path, leaving out non-repositories', async () => {
    const alpha = repository('alpha')
    const beta = repository('nested/beta')
    repository('unnamed')
    const plainDirectory = join(scratch, 'plain')
    mkdirSync(plainDirectory, { recursive: true })
    writeFileSync(listFile, `${beta}\n${alpha}/\n${plainDirectory}\n${join(scratch, 'gone')}\n`)

    const listing = await createListedRepositorySet(listFile).list()
    expect(listing.rootPath).toBeNull()
    expect(listing.repositories).toEqual([
      { name: 'alpha', relativePath: alpha, absolutePath: alpha },
      { name: 'beta', relativePath: beta, absolutePath: beta },
    ])
  })

  test('follows the file as it changes, and serves nothing once it turns malformed', async () => {
    const alpha = repository('alpha')
    const gamma = repository('gamma')
    writeFileSync(listFile, `${alpha}\n`)
    const set = createListedRepositorySet(listFile)
    expect((await set.list()).repositories.map((entry) => entry.name)).toEqual(['alpha'])

    writeFileSync(listFile, `${gamma}\n`)
    expect((await set.list()).repositories.map((entry) => entry.name)).toEqual(['gamma'])

    writeFileSync(listFile, 'gamma\n')
    await expect(set.list()).rejects.toThrow('not an absolute path')
  })
})

describe('createServedRootRepositorySet', () => {
  test('throws at startup on a nonexistent root', () => {
    expect(() => createServedRootRepositorySet('/no/such/place')).toThrow('does not exist')
  })
})
