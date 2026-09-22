import { describe, expect, test } from 'bun:test'
import { FIELD_SEPARATOR, parseGitLog, parseRefDecorations } from './gitLog'

const logLine = (...fields: string[]) => fields.join(FIELD_SEPARATOR)
const FULL_HASH = 'abc1234' + '0'.repeat(33)

describe('parseGitLog', () => {
  test('parses a plain commit line', () => {
    const commits = parseGitLog(
      logLine('abc1234', FULL_HASH, 'def5678', '', 'Ada Lovelace', '2026-07-18', 'feat: add the widget'),
    )
    expect(commits).toEqual([
      {
        hash: 'abc1234',
        fullHash: FULL_HASH,
        parents: ['def5678'],
        refs: [],
        author: 'Ada Lovelace',
        date: '2026-07-18',
        subject: 'feat: add the widget',
      },
    ])
  })

  test('a root commit has no parents', () => {
    const commits = parseGitLog(logLine('abc1234', FULL_HASH, '', '', 'Ada', '2026-07-18', 'Initial commit'))
    expect(commits[0]?.parents).toEqual([])
  })

  test('a merge commit lists all parents in order', () => {
    const commits = parseGitLog(
      logLine('abc1234', FULL_HASH, 'aaa1111 bbb2222', '', 'Ada', '2026-07-18', "Merge branch 'feature'"),
    )
    expect(commits[0]?.parents).toEqual(['aaa1111', 'bbb2222'])
  })

  test('parses ref decorations into individual refs', () => {
    const commits = parseGitLog(
      logLine(
        'abc1234',
        FULL_HASH,
        'def5678',
        ' (HEAD -> main, origin/main, tag: v1.0)',
        'Ada',
        '2026-07-18',
        'release',
      ),
    )
    expect(commits[0]?.refs).toEqual(['HEAD -> main', 'origin/main', 'tag: v1.0'])
  })

  test('a subject containing the field separator survives via tail join', () => {
    const commits = parseGitLog(
      logLine('abc1234', FULL_HASH, '', '', 'Ada', '2026-07-18', `weird${FIELD_SEPARATOR}subject`),
    )
    expect(commits[0]?.subject).toBe(`weird${FIELD_SEPARATOR}subject`)
  })

  test('skips blank and malformed lines quietly', () => {
    const text = [
      '',
      'not a log line at all',
      logLine('abc1234', FULL_HASH, '', '', 'Ada', '2026-07-18', 'good line'),
      '   ',
    ].join('\n')
    const commits = parseGitLog(text)
    expect(commits).toHaveLength(1)
    expect(commits[0]?.subject).toBe('good line')
  })
})

describe('parseRefDecorations', () => {
  test('empty decoration yields no refs', () => {
    expect(parseRefDecorations('')).toEqual([])
    expect(parseRefDecorations('  ')).toEqual([])
  })

  test('strips parentheses and trims entries', () => {
    expect(parseRefDecorations(' (HEAD -> main, feature/x)')).toEqual(['HEAD -> main', 'feature/x'])
  })

  // Regression: a comma is a legal ref-name character, so splitting on the bare
  // comma tore this tag into `tag: v1` plus a loose `origin/release`, which then
  // looked exactly like a remote-tracking ref and was folded into the unrelated
  // `release` branch's pill as a remote agreeing with it. git's separator is a
  // comma *and a space*, and ref names cannot contain spaces, so the name stays
  // whole and nothing is minted.
  test('a comma inside a ref name is not a separator', () => {
    expect(parseRefDecorations(' (HEAD -> main, tag: v1,origin/release, release)')).toEqual([
      'HEAD -> main',
      'tag: v1,origin/release',
      'release',
    ])
  })
})
