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
    render(<CommitGraph commits={commits} selectedHash="aaa1111" selectedDetail={marker} />)
    expect(screen.getByText('INLINE_DETAIL_MARKER')).toBeTruthy()
  })

  test('renders no detail when a detail is provided but nothing is selected', () => {
    render(<CommitGraph commits={commits} selectedHash={null} selectedDetail={marker} />)
    expect(screen.queryByText('INLINE_DETAIL_MARKER')).toBeNull()
  })

  test('renders no detail in sidebar mode (no detail node passed)', () => {
    render(<CommitGraph commits={commits} selectedHash="aaa1111" selectedDetail={null} />)
    expect(screen.queryByText('INLINE_DETAIL_MARKER')).toBeNull()
    // The graph itself still renders both rows.
    expect(screen.getByText('child')).toBeTruthy()
    expect(screen.getByText('parent')).toBeTruthy()
  })
})
