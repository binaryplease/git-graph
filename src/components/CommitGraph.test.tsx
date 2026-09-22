import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { GitCommit } from '../../shared/git.schema'
import { CommitGraph, type CommitContextMenuRequest } from './CommitGraph'

// The inline commit-detail slot: when a row is selected and a detail node is
// provided, the graph expands it in-flow beneath that row; otherwise the graph
// stays unbroken (the host is showing the detail elsewhere, or nothing).

afterEach(cleanup)

const commit = (overrides: Partial<GitCommit>): GitCommit => ({
  hash: 'aaa1111',
  fullHash: '',
  parents: [],
  refs: [],
  author: 'Test',
  date: '2026-07-21',
  subject: 'a commit',
  ...overrides,
})

const commits: GitCommit[] = [
  commit({ hash: 'aaa1111', subject: 'child', parents: ['bbb2222'] }),
  commit({ hash: 'bbb2222', subject: 'parent' }),
]

const marker = <div>INLINE_DETAIL_MARKER</div>

describe('CommitGraph inline detail slot', () => {
  test('renders the detail when a row is selected and a detail is provided', () => {
    render(<CommitGraph commits={commits} remotes={[]} selectedHash="aaa1111" selectedDetail={marker} />)
    expect(screen.getByText('INLINE_DETAIL_MARKER')).toBeTruthy()
  })

  test('renders no detail when a detail is provided but nothing is selected', () => {
    render(<CommitGraph commits={commits} remotes={[]} selectedHash={null} selectedDetail={marker} />)
    expect(screen.queryByText('INLINE_DETAIL_MARKER')).toBeNull()
  })

  test('renders no detail in sidebar mode (no detail node passed)', () => {
    render(<CommitGraph commits={commits} remotes={[]} selectedHash="aaa1111" selectedDetail={null} />)
    expect(screen.queryByText('INLINE_DETAIL_MARKER')).toBeNull()
    // The graph itself still renders both rows.
    expect(screen.getByText('child')).toBeTruthy()
    expect(screen.getByText('parent')).toBeTruthy()
  })
})

// Ref pills: one per ref identity, not one per decoration. The pills are read
// off the DOM by class because a unified pill is several nodes (the branch
// segment, then a segment per remote) rather than one string. The segments carry
// no separator glyph of their own, so a pill's text reads `main origin`.
const pillsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('.ref-pill')].map((pill) => ({
    text: pill.textContent ?? '',
    className: pill.className,
  }))

/** The remote segments of every pill, in DOM order — the appended half of a unified pill. */
const remoteSegmentsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('.ref-segment-remote')].map((segment) => segment.textContent ?? '')

describe('CommitGraph ref pills', () => {
  test('a branch and its remote on one commit render a single segmented pill', () => {
    const { container } = render(
      <CommitGraph
        commits={[commit({ refs: ['HEAD -> main', 'origin/main'] })]}
        remotes={['origin']}
      />,
    )
    const pills = pillsOf(container)
    expect(pills).toHaveLength(1)
    // The name is said once and the remote is appended as its own segment — no
    // `HEAD -> ` plumbing, and no glyph between branch and remote.
    expect(pills[0]!.text).toBe('main origin')
    expect(remoteSegmentsOf(container)).toEqual(['origin'])
    expect(pills[0]!.className).toContain('ref-segmented')
    // Checked out is pill state (the head colour plus weight/ring), not a word.
    expect(pills[0]!.className).toContain('ref-head')
    expect(pills[0]!.className).toContain('ref-checked-out')
    expect(container.innerHTML).not.toContain('HEAD -&gt;')
    // The merged badge stays checkable: the tooltip names the refs that went in.
    expect(container.querySelector('.ref-pill')!.getAttribute('title')).toBe(
      'local branch main (checked out) — in sync with origin/main',
    )
  })

  test('several remotes tracking the same name become further segments of that pill', () => {
    const { container } = render(
      <CommitGraph
        commits={[commit({ refs: ['HEAD -> main', 'origin/main', 'upstream/main'] })]}
        remotes={['origin', 'upstream']}
      />,
    )
    const pills = pillsOf(container)
    expect(pills).toHaveLength(1)
    expect(pills[0]!.text).toBe('main origin upstream')
    expect(remoteSegmentsOf(container)).toEqual(['origin', 'upstream'])
  })

  test('a branch and its remote on different commits keep distinct pills', () => {
    const { container } = render(
      <CommitGraph
        commits={[
          commit({ hash: 'aaa1111', refs: ['HEAD -> main'], parents: ['bbb2222'] }),
          commit({ hash: 'bbb2222', refs: ['origin/main'] }),
        ]}
        remotes={['origin']}
      />,
    )
    const pills = pillsOf(container)
    expect(pills.map((pill) => pill.text)).toEqual(['main', 'origin/main'])
    // Neither row claims an agreement it cannot see: no pill gained a segment.
    expect(remoteSegmentsOf(container)).toEqual([])
    expect(container.querySelector('.ref-segmented')).toBeNull()
  })

  test('a remote-only branch renders as the remote ref it is, with no segments', () => {
    const { container } = render(
      <CommitGraph commits={[commit({ refs: ['origin/feature'] })]} remotes={['origin']} />,
    )
    const pills = pillsOf(container)
    expect(pills).toHaveLength(1)
    expect(pills[0]!.text).toBe('origin/feature')
    expect(pills[0]!.className).toContain('ref-remote')
    expect(pills[0]!.className).not.toContain('ref-segmented')
    expect(remoteSegmentsOf(container)).toEqual([])
  })

  // A remote may legally be named with a slash, and only the longest match
  // splits `fork/alice/main` into the right remote and the right branch — the
  // pill must append `fork/alice`, not `fork`.
  test('a slash-named remote is appended whole as one segment', () => {
    const { container } = render(
      <CommitGraph
        commits={[commit({ refs: ['HEAD -> main', 'fork/alice/main'] })]}
        remotes={['fork/alice']}
      />,
    )
    expect(pillsOf(container).map((pill) => pill.text)).toEqual(['main fork/alice'])
    expect(remoteSegmentsOf(container)).toEqual(['fork/alice'])
  })

  // Regression: with `remotes={[]}` — git's answer for a repository with no
  // remote-tracking refs — a local branch that merely looks like `origin/x` must
  // not be folded in as a remote. The pill used to read `main ⇅ origin` and claim
  // a sync with a ref that does not exist.
  test('no remotes: a branch named origin/main renders on its own, with no remote segment', () => {
    const { container } = render(
      <CommitGraph commits={[commit({ refs: ['HEAD -> main', 'origin/main'] })]} remotes={[]} />,
    )
    const pills = pillsOf(container)
    expect(pills.map((pill) => pill.text)).toEqual(['main', 'origin/main'])
    expect(remoteSegmentsOf(container)).toEqual([])
    // Classified local, not remote — and nothing in the DOM says "in sync".
    expect(pills[1]!.className).toContain('ref-branch')
    expect(container.innerHTML).not.toContain('in sync')
  })

  test('a tag is never folded into the branch pill, and is never checked out', () => {
    const { container } = render(
      <CommitGraph
        commits={[commit({ refs: ['HEAD -> v1.0', 'origin/v1.0', 'tag: v1.0'] })]}
        remotes={['origin']}
      />,
    )
    const pills = pillsOf(container)
    expect(pills).toHaveLength(2)
    expect(pills[1]!.text).toBe('v1.0')
    expect(pills[1]!.className).toContain('ref-tag')
    expect(pills[1]!.className).not.toContain('ref-checked-out')
  })

  // Regression: a comma is legal in a ref name, a space is not, so `%d` splits
  // on `", "` only. A tag named `v1,origin/release` must not forge a remote
  // segment onto the `release` branch's pill.
  test('a comma-bearing tag name never becomes another branch’s remote segment', () => {
    const { container } = render(
      <CommitGraph
        commits={[commit({ refs: ['HEAD -> main', 'tag: v1,origin/release', 'release'] })]}
        remotes={['origin']}
      />,
    )
    expect(pillsOf(container).map((pill) => pill.text)).toEqual([
      'main',
      'v1,origin/release',
      'release',
    ])
    expect(remoteSegmentsOf(container)).toEqual([])
  })
})

// The row-level half of the checked-out signal (the pill carries the other
// half as state): a lane-coloured ring before the row's pills, never a second
// ring on the SVG node, where the selection halo already owns that shape.
describe('CommitGraph checked-out row marker', () => {
  const markersOf = (container: HTMLElement) => [...container.querySelectorAll('.ref-head-dot')]

  test('the HEAD row is ringed, and the ring names the checked-out branch', () => {
    const { container } = render(
      <CommitGraph
        commits={[
          commit({ hash: 'aaa1111', refs: ['HEAD -> main', 'origin/main'], parents: ['bbb2222'] }),
          commit({ hash: 'bbb2222', refs: ['origin/other'] }),
        ]}
        remotes={['origin']}
      />,
    )
    const markers = markersOf(container)
    expect(markers).toHaveLength(1)
    const description = 'The branch "main" is currently checked out at this commit.'
    expect(markers[0]!.getAttribute('title')).toBe(description)
    // The explanation reaches assistive tech too, not only a hover tooltip.
    expect(markers[0]!.getAttribute('aria-label')).toBe(description)
    // It rings in the row's own lane colour.
    expect(markers[0]!.getAttribute('style')).toContain('var(--lane-0)')
    // The graph composes the shared cluster rather than placing the ring
    // itself, so the arrangement CommitRefRow owns holds here too: same line as
    // the pills, immediately before the first (ADR-0027).
    const nextToRing = markers[0]!.nextElementSibling
    expect(nextToRing?.classList.contains('ref-pill')).toBe(true)
    expect(nextToRing?.textContent).toBe('main origin')
  })

  test('a commit with no ref at all is unmarked', () => {
    const { container } = render(<CommitGraph commits={commits} remotes={[]} />)
    expect(markersOf(container)).toHaveLength(0)
  })

  // A detached HEAD is on no branch, so there is no branch to name — the row
  // stays unmarked and the `HEAD` pill speaks for itself.
  test('a detached HEAD leaves the row unmarked and keeps its own pill', () => {
    const { container } = render(
      <CommitGraph commits={[commit({ refs: ['HEAD', 'main'] })]} remotes={['origin']} />,
    )
    expect(markersOf(container)).toHaveLength(0)
    const pills = pillsOf(container)
    expect(pills.map((pill) => pill.text)).toEqual(['HEAD', 'main'])
    expect(pills[0]!.className).toContain('ref-head')
    expect(pills[0]!.className).not.toContain('ref-checked-out')
  })
})

// The context-menu seam (issue #2): a right-click on a row or a pill, or the
// keyboard's context-menu keys on a focused row, hand the host a request — and
// the browser's own menu is suppressed over exactly those targets. Without a
// handler the graph leaves the browser's menu alone.
describe('CommitGraph context menu', () => {
  const decorated = [
    commit({ hash: 'aaa1111', subject: 'child', parents: ['bbb2222'], refs: ['HEAD -> main', 'tag: v1.0'] }),
    commit({ hash: 'bbb2222', subject: 'parent' }),
  ]
  const rowOf = (subject: string) => screen.getByText(subject).closest('button')!
  const pillOf = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('.ref-pill')].find((pill) => pill.textContent === text)!

  const renderWithMenu = () => {
    const requests: CommitContextMenuRequest[] = []
    render(<CommitGraph commits={decorated} remotes={[]} onContextMenu={(request) => requests.push(request)} />)
    return requests
  }

  test('a right-click on a row asks for the row menu at the pointer and suppresses the browser menu', () => {
    const requests = renderWithMenu()
    const event = createEvent.contextMenu(rowOf('parent'), { clientX: 40, clientY: 70 })
    fireEvent(rowOf('parent'), event)
    expect(event.defaultPrevented).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ focusedGroup: null, anchor: { x: 40, y: 70 } })
    expect(requests[0]!.commit.hash).toBe('bbb2222')
  })

  test('a right-click on a pill asks for that ref’s menu, once — not the row’s as well', () => {
    const requests = renderWithMenu()
    const event = createEvent.contextMenu(pillOf('v1.0'), { clientX: 12, clientY: 20 })
    fireEvent(pillOf('v1.0'), event)
    expect(event.defaultPrevented).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.focusedGroup).toMatchObject({ kind: 'tag', name: 'v1.0' })
    expect(requests[0]!.refGroups.map((group) => group.name)).toEqual(['main', 'v1.0'])
  })

  test('Shift+F10 and the context-menu key open the row menu from the keyboard', () => {
    const requests = renderWithMenu()
    const row = rowOf('child')
    expect(row.getAttribute('aria-keyshortcuts')).toBe('Shift+F10')
    const shiftF10 = createEvent.keyDown(row, { key: 'F10', shiftKey: true })
    fireEvent(row, shiftF10)
    expect(shiftF10.defaultPrevented).toBe(true)
    fireEvent.keyDown(row, { key: 'ContextMenu' })
    // A plain F10 is not a context-menu request.
    fireEvent.keyDown(row, { key: 'F10' })
    expect(requests.map((request) => [request.commit.hash, request.focusedGroup])).toEqual([
      ['aaa1111', null],
      ['aaa1111', null],
    ])
  })

  test('without a handler the browser keeps its own menu', () => {
    render(<CommitGraph commits={decorated} remotes={[]} />)
    const rowEvent = createEvent.contextMenu(rowOf('parent'))
    fireEvent(rowOf('parent'), rowEvent)
    const pillEvent = createEvent.contextMenu(pillOf('v1.0'))
    fireEvent(pillOf('v1.0'), pillEvent)
    expect(rowEvent.defaultPrevented).toBe(false)
    expect(pillEvent.defaultPrevented).toBe(false)
    expect(rowOf('parent').hasAttribute('aria-keyshortcuts')).toBe(false)
  })
})
