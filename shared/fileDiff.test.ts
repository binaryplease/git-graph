import { describe, expect, test } from 'bun:test'
import { languageForPath, splitPatchIntoFileHunks } from './fileDiff'

describe('languageForPath', () => {
  test('maps the extensions the client can highlight', () => {
    expect(languageForPath('src/App.tsx')).toBe('tsx')
    expect(languageForPath('server/index.ts')).toBe('typescript')
    expect(languageForPath('shared/graphLayout.test.ts')).toBe('typescript')
    expect(languageForPath('src/index.css')).toBe('css')
    expect(languageForPath('package.json')).toBe('json')
    expect(languageForPath('README.md')).toBe('markdown')
  })

  test('recognises well-known extensionless filenames', () => {
    expect(languageForPath('Makefile')).toBe('makefile')
    expect(languageForPath('docker/Dockerfile')).toBe('dockerfile')
    expect(languageForPath('.bashrc')).toBe('bash')
  })

  test('falls back to txt rather than failing on an unknown path', () => {
    expect(languageForPath('LICENSE')).toBe('txt')
    expect(languageForPath('notes.qqq')).toBe('txt')
    expect(languageForPath('')).toBe('txt')
  })

  test('is case-insensitive, since the extension is not the content', () => {
    expect(languageForPath('deep/path/Style.CSS')).toBe('css')
    expect(languageForPath('MAKEFILE')).toBe('makefile')
  })
})

describe('splitPatchIntoFileHunks', () => {
  const patch = [
    'diff --git a/a.txt b/a.txt',
    'index 1234567..89abcde 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1,2 @@',
    ' one',
    '+two',
  ].join('\n')

  test('returns one entry for a single-file patch', () => {
    expect(splitPatchIntoFileHunks(patch)).toEqual([patch])
  })

  test('splits at each diff --git header', () => {
    const second = 'diff --git a/b.txt b/b.txt\n@@ -0,0 +1 @@\n+hello'
    expect(splitPatchIntoFileHunks(`${patch}\n${second}`)).toEqual([patch, second])
  })

  test('an empty patch yields no hunks', () => {
    expect(splitPatchIntoFileHunks('')).toEqual([])
    expect(splitPatchIntoFileHunks('\n  \n')).toEqual([])
  })

  test('does not split on a diff --git line inside the diff body', () => {
    const withQuotedHeader = `${patch}\n+diff --git a/x b/x`
    expect(splitPatchIntoFileHunks(withQuotedHeader)).toHaveLength(1)
  })
})
