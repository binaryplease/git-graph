import { afterEach, describe, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { GitCommit } from '../../shared/git.schema'
import { BranchGraph, BRANCH_LINE_COMMIT_LIMIT, relativeAge, type BranchGraphProps } from './BranchGraph'

// The Branches view (variant A2). The fixture mirrors the one in
// shared/branchTree.test.ts: main over upstream/main, feature/x over its remote,
// a merged branch, spike/pdf-renderer with spike/pdf-fonts forked from it, and a
// deleted branch whose two commits came in through merge m4.

afterEach(cleanup)

const commit = (hash: string, parents: string[], refs: string[] = [], subject = `subject ${hash}`): GitCommit => ({
  hash,
  fullHash: '',
  parents,
  refs,
  author: 'Test Author',
  date: '2026-11-01',
  subject,
})

const COMMITS: GitCommit[] = [
  commit('m1', ['m2'], ['HEAD -> main', 'origin/main']),
  commit('x1', ['x2'], ['feature/x']),
  commit('x2', ['m2'], ['origin/feature/x']),
  commit('t1', ['m3'], ['tag: v0.9-hotfix']),
  commit('m2', ['m3', 'g1'], [], 'Merge feature/merged'),
  commit('g1', ['g2'], ['feature/merged']),
  commit('g2', ['m4']),
  commit('m3', ['m4'], ['upstream/main']),
  commit('f1', ['r3'], ['spike/pdf-fonts']),
  commit('r1', ['r2'], ['spike/pdf-renderer'], 'docs: write down the renderer comparison'),
  commit('r2', ['r3']),
  commit('r3', ['r4']),
  commit('r4', ['m4']),
  commit('m4', ['m5', 'd1'], [], 'Merge a deleted branch'),
  commit('d1', ['d2'], [], 'deleted branch work'),
  commit('d2', ['m5']),
  commit('m5', [], ['tag: v1.0']),
]

const NOW = Date.parse('2026-11-14T12:00:00Z')

function renderGraph(overrides: Partial<BranchGraphProps> = {}) {
  return render(
    <BranchGraph
      commits={COMMITS}
      remotes={['origin', 'upstream']}
      defaultBranch="main"
      tagsAsRows={false}
      now={NOW}
      {...overrides}
    />,
  )
}

const rowsOfKind = (container: HTMLElement, kind: string) =>
  [...container.querySelectorAll<HTMLButtonElement>(`[data-row-kind="${kind}"]`)]
const rowKeys = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-row-key]')].map((element) => element.dataset.rowKey)
const refRow = (container: HTMLElement, hash: string) =>
  container.querySelector<HTMLButtonElement>(`[data-row-key="ref:${hash}"]`)!
const refNodeX = (container: HTMLElement) =>
  Object.fromEntries(
    [...container.querySelectorAll('circle[data-ref-node]')].map((node) => [
      node.getAttribute('data-ref-node'),
      node.getAttribute('cx'),
    ]),
  )

describe('BranchGraph — rows', () => {
  test('one row per ref and no commit rows while every row is closed', () => {
    const { container } = renderGraph()
    expect(rowKeys(container)).toEqual(['ref:m1', 'ref:x1', 'ref:x2', 'ref:t1', 'ref:m3', 'ref:g1', 'ref:r1', 'ref:f1'])
    expect(rowsOfKind(container, 'commit')).toHaveLength(0)
    for (const row of rowsOfKind(container, 'ref')) expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  test('ref pills come from the shared components: grouped, ringed when checked out, never "HEAD ->"', () => {
    const { container } = renderGraph()
    const mainRow = refRow(container, 'm1')
    expect(mainRow.querySelector('.ref-pill.ref-checked-out')?.textContent).toBe('main origin')
    expect(mainRow.querySelector('.ref-head-dot')).not.toBeNull()
    expect(container.textContent).not.toContain('HEAD ->')
  })

  test('a ref row shows its line length, the tip author and the relative age', () => {
    const { container } = renderGraph()
    const row = refRow(container, 'r1')
    expect(row.querySelector('[data-testid="line-count"]')?.textContent).toBe('4 commits')
    expect(row.textContent).toContain('Test Author')
    expect(row.textContent).toContain('13 days ago')
  })

  test('clicking a ref row lists its line’s commits beneath it and toggles aria-expanded', () => {
    const { container } = renderGraph()
    fireEvent.click(refRow(container, 'r1'))
    expect(refRow(container, 'r1').getAttribute('aria-expanded')).toBe('true')
    const keys = rowKeys(container)
    const at = keys.indexOf('ref:r1')
    // r1, r2, then spike/pdf-fonts' row above its fork r3, then r3 and r4.
    expect(keys.slice(at, at + 6)).toEqual(['ref:r1', 'r1', 'r2', 'ref:f1', 'r3', 'r4'])
    // The tip's refs are on the ref row already, not repeated on the tip commit.
    expect(container.querySelector('[data-row-key="r1"] .ref-pill')).toBeNull()
    fireEvent.click(refRow(container, 'r1'))
    expect(refRow(container, 'r1').getAttribute('aria-expanded')).toBe('false')
    expect(rowsOfKind(container, 'commit')).toHaveLength(0)
  })

  test('opening a row never moves a lane', () => {
    const { container } = renderGraph()
    const before = refNodeX(container)
    fireEvent.click(refRow(container, 'm3'))
    fireEvent.click(refRow(container, 'r1'))
    expect(refNodeX(container)).toEqual(before)
  })

  test('"from …" names the line a ref leaves, and stays off the default line and continuations', () => {
    const { container } = renderGraph()
    const lineLeft = (hash: string) => refRow(container, hash).querySelector('[data-testid="line-left"]')?.textContent ?? null
    expect(lineLeft('f1')).toBe('from spike/pdf-renderer')
    expect(lineLeft('r1')).toBe('from main')
    expect(lineLeft('m1')).toBeNull()
    expect(lineLeft('m3')).toBeNull()
    expect(lineLeft('x1')).toBeNull()
  })

  test('a merge that brought in commits of no line says "+N merged" and explains it', () => {
    const { container } = renderGraph()
    fireEvent.click(refRow(container, 'm3'))
    const merge = container.querySelector('[data-row-key="m4"]')!
    const badge = [...merge.querySelectorAll('span')].find((span) => span.textContent === '+2 merged')
    expect(badge).toBeDefined()
    expect(badge!.getAttribute('title')).toContain('2 commits')
    // The merge of a branch that still has its ref adds no badge.
    fireEvent.click(refRow(container, 'm1'))
    expect(container.querySelector('[data-row-key="m2"]')!.textContent).not.toMatch(/\+\d+ merged/)
  })

  test('tags as rows gives a tag-only commit its own row', () => {
    const { container } = renderGraph({ tagsAsRows: true })
    expect(rowKeys(container)).toContain('ref:m5')
  })
})

describe('BranchGraph — long lines', () => {
  // main with 30 commits on its line.
  const longLine = Array.from({ length: 30 }, (_, index) =>
    commit(`c${index}`, index < 29 ? [`c${index + 1}`] : [], index === 0 ? ['main'] : [], `commit number ${index}`),
  )

  test(`an open line lists ${BRANCH_LINE_COMMIT_LIMIT} commits, then "show N more"`, () => {
    const { container } = renderGraph({ commits: longLine, remotes: [] })
    fireEvent.click(refRow(container, 'c0'))
    expect(rowsOfKind(container, 'commit')).toHaveLength(BRANCH_LINE_COMMIT_LIMIT)
    const more = rowsOfKind(container, 'more')
    expect(more).toHaveLength(1)
    expect(more[0]!.textContent).toBe('show 5 more commits')
    fireEvent.click(more[0]!)
    expect(rowsOfKind(container, 'commit')).toHaveLength(30)
    expect(rowsOfKind(container, 'more')).toHaveLength(0)
  })

  test('selecting a commit past the limit opens its line far enough to show it', () => {
    const { container } = renderGraph({ commits: longLine, remotes: [], selectedHash: 'c28' })
    expect(container.querySelector('[data-row-key="c28"]')?.getAttribute('aria-current')).toBe('true')
  })
})

describe('BranchGraph — selection', () => {
  test('a commit row selects; the detail opens beneath it', () => {
    const onSelectCommit = mock((_commit: GitCommit) => {})
    const { container, rerender } = renderGraph({ onSelectCommit })
    fireEvent.click(refRow(container, 'r1'))
    fireEvent.click(container.querySelector('[data-row-key="r2"]')!)
    expect(onSelectCommit.mock.calls[0]![0].hash).toBe('r2')
    rerender(
      <BranchGraph
        commits={COMMITS}
        remotes={['origin', 'upstream']}
        defaultBranch="main"
        tagsAsRows={false}
        now={NOW}
        selectedHash="r2"
        selectedDetail={<div>DETAIL_MARKER</div>}
      />,
    )
    const row = container.querySelector('[data-row-key="r2"]')!
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.nextElementSibling?.textContent).toBe('DETAIL_MARKER')
  })

  test('a selected side commit shows beneath the merge that brought it in', () => {
    const { container } = renderGraph({ selectedHash: 'd1' })
    const keys = rowKeys(container)
    expect(keys[keys.indexOf('m4') + 1]).toBe('side:d1')
    expect(container.querySelector('[data-row-key="side:d1"]')!.textContent).toContain('merged by m4')
  })

  test('closing the line that holds the selected commit clears the selection', () => {
    const onClearSelection = mock(() => {})
    const { container } = renderGraph({ selectedHash: 'r2', onClearSelection })
    expect(refRow(container, 'r1').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(refRow(container, 'r1'))
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })
})

describe('BranchGraph — search', () => {
  test('lines holding a match open; rows that do not match dim; matched characters are marked', () => {
    const onStats = mock(() => {})
    const { container } = renderGraph({ searchQuery: 'renderer', onStats })
    expect(refRow(container, 'r1').getAttribute('aria-expanded')).toBe('true')
    expect(refRow(container, 'r1').className).not.toContain('opacity-25')
    expect(refRow(container, 'm1').getAttribute('aria-expanded')).toBe('false')
    expect(refRow(container, 'm1').className).toContain('opacity-25')
    const tip = container.querySelector('[data-row-key="r1"]')!
    expect(tip.className).not.toContain('opacity-25')
    expect(tip.querySelector('mark')).not.toBeNull()
    expect(container.querySelector('[data-row-key="r2"]')!.className).toContain('opacity-25')
    expect(refRow(container, 'r1').querySelector('[data-testid="line-count"]')?.textContent).toBe('1 of 4 commits')
    expect(onStats).toHaveBeenLastCalledWith({ laneCount: 4, refCount: 8, matchCount: 1 })
  })

  test('a matching side commit is shown beneath its merge, never counted but hidden', () => {
    const onStats = mock(() => {})
    const { container } = renderGraph({ searchQuery: 'deleted', onStats })
    // d1 ("deleted branch work") lies on no line; m4 ("Merge a deleted branch"),
    // on upstream/main's line, merged it. Both match.
    expect(onStats).toHaveBeenLastCalledWith({ laneCount: 4, refCount: 8, matchCount: 2 })
    expect(refRow(container, 'm3').getAttribute('aria-expanded')).toBe('true')
    expect(refRow(container, 'm3').className).not.toContain('opacity-25')
    const keys = rowKeys(container)
    expect(keys[keys.indexOf('m4') + 1]).toBe('side:d1')
    const sideRow = container.querySelector('[data-row-key="side:d1"]')!
    expect(sideRow.className).not.toContain('opacity-25')
    expect(sideRow.querySelector('mark')).not.toBeNull()
    // The unmatched side commit d2 stays out.
    expect(keys).not.toContain('side:d2')
  })

  test('a line opened by a match closes on click', () => {
    const { container } = renderGraph({ searchQuery: 'renderer' })
    fireEvent.click(refRow(container, 'r1'))
    expect(refRow(container, 'r1').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('BranchGraph — keyboard', () => {
  test('Up and Down move between rows', () => {
    const { container } = renderGraph()
    refRow(container, 'm1').focus()
    fireEvent.keyDown(refRow(container, 'm1'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(refRow(container, 'x1'))
    fireEvent.keyDown(refRow(container, 'x1'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(refRow(container, 'm1'))
  })

  test('Right opens a closed ref row, Left closes an open one', () => {
    const { container } = renderGraph()
    fireEvent.keyDown(refRow(container, 'r1'), { key: 'ArrowRight' })
    expect(refRow(container, 'r1').getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(refRow(container, 'r1'), { key: 'ArrowLeft' })
    expect(refRow(container, 'r1').getAttribute('aria-expanded')).toBe('false')
  })

  test('Left on a commit moves focus to its ref row', () => {
    const { container } = renderGraph()
    fireEvent.click(refRow(container, 'r1'))
    const commitRow = container.querySelector<HTMLElement>('[data-row-key="r3"]')!
    commitRow.focus()
    fireEvent.keyDown(commitRow, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(refRow(container, 'r1'))
  })

  test('Escape clears the selection, and handled keys never reach the host', () => {
    const onClearSelection = mock(() => {})
    const hostListener = mock(() => {})
    window.addEventListener('keydown', hostListener)
    const { container } = renderGraph({ onClearSelection })
    fireEvent.keyDown(refRow(container, 'm1'), { key: 'Escape' })
    fireEvent.keyDown(refRow(container, 'm1'), { key: 'ArrowDown' })
    window.removeEventListener('keydown', hostListener)
    expect(onClearSelection).toHaveBeenCalledTimes(1)
    expect(hostListener).not.toHaveBeenCalled()
  })

  test('Enter and Space are left to the native button, which activates the row', () => {
    const { container } = renderGraph()
    for (const row of [...container.querySelectorAll('[data-row-key]')]) {
      expect(row.tagName).toBe('BUTTON')
      expect(row.getAttribute('type')).toBe('button')
    }
    const enter = fireEvent.keyDown(refRow(container, 'm1'), { key: 'Enter' })
    expect(enter).toBe(true) // not default-prevented
  })
})

describe('relativeAge', () => {
  test('reads days, weeks, months and years', () => {
    expect(relativeAge('2026-11-14', NOW)).toBe('today')
    expect(relativeAge('2026-11-13', NOW)).toBe('1 day ago')
    expect(relativeAge('2026-11-04', NOW)).toBe('10 days ago')
    expect(relativeAge('2026-10-17', NOW)).toBe('4 weeks ago')
    expect(relativeAge('2026-05-14', NOW)).toBe('6 months ago')
    expect(relativeAge('2023-11-14', NOW)).toBe('3 years ago')
  })
})
