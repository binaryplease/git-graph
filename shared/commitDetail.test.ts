import { describe, expect, test } from 'bun:test'
import { MAX_FILE_CHANGES, parseCommitDetail, parseCommitFileChanges } from './commitDetail'

// Build a header the way `git show --format=COMMIT_DETAIL_PRETTY_FORMAT` does:
// unit-separated fields, then the record separator, then the file block.
function showOutput(fields: string[], fileBlock = '') {
  return `${fields.join('\x1f')}\x1e${fileBlock}`
}

const HEADER_FIELDS = [
  'e505ce29d411f2e4793a0925806bd3555c694b7c',
  'e505ce2',
  '1be54cb a4a2e40',
  'HEAD -> main, origin/main, tag: v1.0',
  'Tester',
  'tester@example.com',
  '2026-07-20T12:26:25+02:00',
  'Committer',
  'committer@example.com',
  '2026-07-20T12:30:00+02:00',
  'main commit',
  '',
]

describe('parseCommitDetail', () => {
  test('parses every header field of a commit', () => {
    const detail = parseCommitDetail(showOutput(HEADER_FIELDS))
    expect(detail).not.toBeNull()
    expect(detail!.fullHash).toBe('e505ce29d411f2e4793a0925806bd3555c694b7c')
    expect(detail!.hash).toBe('e505ce2')
    expect(detail!.parents).toEqual(['1be54cb', 'a4a2e40'])
    expect(detail!.refs).toEqual(['HEAD -> main', 'origin/main', 'tag: v1.0'])
    expect(detail!.author).toBe('Tester')
    expect(detail!.authorEmail).toBe('tester@example.com')
    expect(detail!.authorDate).toBe('2026-07-20T12:26:25+02:00')
    expect(detail!.committer).toBe('Committer')
    expect(detail!.committerDate).toBe('2026-07-20T12:30:00+02:00')
    expect(detail!.subject).toBe('main commit')
    expect(detail!.body).toBe('')
  })

  test('keeps a multi-line body intact and trims its trailing blank lines', () => {
    const body = 'A body line.\n\nAnd a second paragraph.'
    const detail = parseCommitDetail(showOutput([...HEADER_FIELDS.slice(0, 11), `${body}\n\n`]))
    expect(detail!.body).toBe(body)
  })

  test('tolerates a unit separator inside the body (tail join)', () => {
    const detail = parseCommitDetail(showOutput([...HEADER_FIELDS.slice(0, 11), 'before\x1fafter']))
    expect(detail!.body).toBe('before\x1fafter')
  })

  test('reports a root commit as having no parents', () => {
    const fields = [...HEADER_FIELDS]
    fields[2] = ''
    expect(parseCommitDetail(showOutput(fields))!.parents).toEqual([])
  })

  test('returns null when the record separator or the fields are missing', () => {
    expect(parseCommitDetail('no separator here')).toBeNull()
    expect(parseCommitDetail(showOutput(['just', 'two']))).toBeNull()
    expect(parseCommitDetail(showOutput(['', ...HEADER_FIELDS.slice(1)]))).toBeNull()
  })
})

describe('parseCommitFileChanges', () => {
  test('zips raw status lines with their numstat counts', () => {
    const { files, truncated } = parseCommitFileChanges(
      [
        ':100644 100644 5626abf 814f4a4 M\ta.txt',
        ':000000 100644 0000000 0f49c4a A\tnew.txt',
        '1\t0\ta.txt',
        '4\t0\tnew.txt',
      ].join('\n'),
    )
    expect(truncated).toBe(false)
    expect(files).toEqual([
      { path: 'a.txt', previousPath: null, status: 'modified', additions: 1, deletions: 0, binary: false },
      { path: 'new.txt', previousPath: null, status: 'added', additions: 4, deletions: 0, binary: false },
    ])
  })

  test('carries the source path of a rename and strips its similarity score', () => {
    const { files } = parseCommitFileChanges(
      [':100644 100644 814f4a4 de7b749 R061\ta.txt\trenamed.txt', '1\t0\ta.txt => renamed.txt'].join('\n'),
    )
    expect(files[0]).toEqual({
      path: 'renamed.txt',
      previousPath: 'a.txt',
      status: 'renamed',
      additions: 1,
      deletions: 0,
      binary: false,
    })
  })

  test('marks binaries, whose counts git reports as dashes, with null counts', () => {
    const { files } = parseCommitFileChanges(
      [':000000 100644 0000000 0f49c4a A\tblob.bin', '-\t-\tblob.bin'].join('\n'),
    )
    expect(files[0]).toEqual({
      path: 'blob.bin',
      previousPath: null,
      status: 'added',
      additions: null,
      deletions: null,
      binary: true,
    })
  })

  test('maps a deletion and an unrecognised status letter', () => {
    const { files } = parseCommitFileChanges(
      [':100644 000000 587be6b 0000000 D\tgone.txt', ':100644 100644 aaa bbb X\tweird.txt'].join('\n'),
    )
    expect(files.map((file) => file.status)).toEqual(['deleted', 'unknown'])
    // No numstat partner — counts stay null and the file is not called binary.
    expect(files[0]!.additions).toBeNull()
    expect(files[0]!.binary).toBe(false)
  })

  test('is empty for a commit that changed nothing', () => {
    expect(parseCommitFileChanges('').files).toEqual([])
  })

  test('truncates very large file lists and says so', () => {
    const rawLines: string[] = []
    const numstatLines: string[] = []
    for (let fileIndex = 0; fileIndex < MAX_FILE_CHANGES + 5; fileIndex += 1) {
      rawLines.push(`:000000 100644 0000000 0f49c4a A\tfile-${fileIndex}.txt`)
      numstatLines.push(`1\t0\tfile-${fileIndex}.txt`)
    }
    const { files, truncated } = parseCommitFileChanges([...rawLines, ...numstatLines].join('\n'))
    expect(files).toHaveLength(MAX_FILE_CHANGES)
    expect(truncated).toBe(true)
  })
})
