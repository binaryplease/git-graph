import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import type { GitCommit } from '../../shared/git.schema'
import { CommitGraph } from './CommitGraph'

// The inline commit-detail slot: when a row is selected and a detail node is
// provided, the graph expands it in-flow beneath that row; otherwise the graph
// stays unbroken (the host is showing the detail elsewhere, or nothing).

afterEach(cleanup)

const commit = (overrides: Partial<GitCommit>): GitCommit => ({
  hash: 'aaa1111',
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
// off the DOM by class because a unified pill is several nodes (the HEAD marker,
// the name, the synced marker) rather than one string.
const pillsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('.ref-pill')].map((pill) => ({
    text: pill.textContent ?? '',
    className: pill.className,
  }))

describe('CommitGraph ref pills', () => {
  test('a branch and its remote on one commit render a single pill', () => {
    const { container } = render(
      <CommitGraph
        commits={[commit({ refs: ['HEAD -> main', 'origin/main'] })]}
        remotes={['origin']}
      />,
    )
    const pills = pillsOf(container)
    expect(pills).toHaveLength(1)
    // The HEAD marker survives, the name is said once, and the remote is named.
    expect(pills[0]!.text).toBe('HEAD -> main origin')
    expect(pills[0]!.className).toContain('ref-head')
    expect(container.querySelector('.ref-synced')).toBeTruthy()
  })

  test('several remotes tracking the same name collapse into that pill', () => {
    const { container } = render(
      <CommitGraph
        commits={[commit({ refs: ['HEAD -> main', 'origin/main', 'upstream/main'] })]}
        remotes={['origin', 'upstream']}
      />,
    )
    const pills = pillsOf(container)
    expect(pills).toHaveLength(1)
    expect(pills[0]!.text).toContain('origin, upstream')
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
    expect(pills.map((pill) => pill.text)).toEqual(['HEAD -> main', 'origin/main'])
    // Neither row claims a sync it cannot see.
    expect(container.querySelector('.ref-synced')).toBeNull()
  })

  test('a remote-only branch renders as the remote ref it is', () => {
    const { container } = render(
      <CommitGraph commits={[commit({ refs: ['origin/feature'] })]} remotes={['origin']} />,
    )
    const pills = pillsOf(container)
    expect(pills).toHaveLength(1)
    expect(pills[0]!.text).toBe('origin/feature')
    expect(pills[0]!.className).toContain('ref-remote')
  })

  // Regression: with `remotes={[]}` — git's answer for a repository with no
  // remote-tracking refs — a local branch that merely looks like `origin/x` must
  // not be folded in as a remote. The pill used to read `main ⇅ origin` and claim
  // a sync with a ref that does not exist.
  test('no remotes: a branch named origin/main renders on its own, with no synced marker', () => {
    const { container } = render(
      <CommitGraph commits={[commit({ refs: ['HEAD -> main', 'origin/main'] })]} remotes={[]} />,
    )
    const pills = pillsOf(container)
    expect(pills.map((pill) => pill.text)).toEqual(['HEAD -> main', 'origin/main'])
    expect(container.querySelector('.ref-synced')).toBeNull()
    // Classified local, not remote — and nothing in the DOM says "in sync".
    expect(pills[1]!.className).toContain('ref-branch')
    expect(container.innerHTML).not.toContain('in sync')
  })

  test('a tag is never folded into the branch pill', () => {
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
  })
})
