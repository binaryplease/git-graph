import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CommitFileChange, WorkingTree } from '../../shared/git.schema'
import { UncommittedChangesRow } from './UncommittedChangesRow'

// The working-tree node above HEAD, now a shared render component: the clean
// state (ADR-0025 — the row stays and explains itself rather than vanishing),
// and the two open seams a host may drive it through — a standalone diff-tab
// href (this repo) or an in-app handler (nightshift-ui, which has no diff-tab
// routes). Only one of the two may render, and a handler-driven row must be a
// button, not a link with a dead href.

afterEach(cleanup)

const change = (overrides: Partial<CommitFileChange>): CommitFileChange => ({
  path: 'src/app.ts',
  previousPath: null,
  status: 'modified',
  additions: 3,
  deletions: 1,
  binary: false,
  ...overrides,
})

const workingTree = (overrides: Partial<WorkingTree> = {}): WorkingTree => ({
  repository: 'demo',
  head: 'abc1234',
  branch: 'main',
  files: [change({}), change({ path: 'README.md', additions: 7, deletions: 0 })],
  filesTruncated: false,
  ...overrides,
})

describe('UncommittedChangesRow', () => {
  test('states a clean tree and offers nothing to open', () => {
    render(<UncommittedChangesRow working={workingTree({ files: [] })} contentLeft={32} href="/working" />)
    expect(screen.getByText('Working tree clean')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('counts the changed files and sums their line stats', () => {
    render(<UncommittedChangesRow working={workingTree()} contentLeft={32} href="/working?repo=demo" />)
    expect(screen.getByText('Uncommitted changes')).toBeTruthy()
    expect(screen.getByText('2 files')).toBeTruthy()
    // 3 + 7 additions, 1 + 0 deletions.
    expect(screen.getByText('+10')).toBeTruthy()
    expect(screen.getByText('−1')).toBeTruthy()
  })

  test('marks a truncated listing so the count never reads as exact', () => {
    render(
      <UncommittedChangesRow
        working={workingTree({ filesTruncated: true })}
        contentLeft={32}
        href="/working"
      />,
    )
    expect(screen.getByText('2 files+')).toBeTruthy()
  })

  test('renders a real link for a host with a diff tab', () => {
    render(<UncommittedChangesRow working={workingTree()} contentLeft={32} href="/working?repo=demo" />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/working?repo=demo')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  test('renders a button — never a dead link — for a host that opens in-app', () => {
    let opened = 0
    render(
      <UncommittedChangesRow working={workingTree()} contentLeft={32} onOpen={() => (opened += 1)} />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(opened).toBe(1)
  })

  test('the handler wins when a host supplies both seams', () => {
    let opened = 0
    render(
      <UncommittedChangesRow
        working={workingTree()}
        contentLeft={32}
        href="/working"
        onOpen={() => (opened += 1)}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(opened).toBe(1)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
