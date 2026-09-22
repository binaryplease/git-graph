import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GitCommit } from '../../shared/git.schema'
import type { GitMenuInput } from '../../shared/gitActions'
import { groupRefDecorations } from '../../shared/refGroup'
import { GitActionMenu, type GitActionMenuProps } from './GitActionMenu'

// The menu is the shared unit a host opens on a row or pill, so what is pinned
// is what a host gets from it: every entry present whether or not the host
// wired its handler (disabled with a reason when not, ADR-0025), a checkout only
// ever *requested* through the host's handler, and the keyboard contract issue
// #2 asks for — arrows move, Enter invokes, Escape closes.

afterEach(cleanup)

const FULL_HASH = 'abc1234'.padEnd(40, '0')

const commit: GitCommit = {
  hash: 'abc1234',
  fullHash: FULL_HASH,
  parents: [],
  refs: ['HEAD -> main', 'feature', 'tag: v1.0'],
  author: 'Ada',
  date: '2026-09-22',
  subject: 'a commit',
}

const rowInput = (): GitMenuInput => ({
  commit,
  refGroups: groupRefDecorations(commit.refs, []),
  focusedGroup: null,
  head: { hash: 'abc1234', branch: 'main' },
  defaultBranch: 'main',
})

const renderMenu = (props: Partial<GitActionMenuProps> = {}) => {
  const onClose = mock(() => {})
  const result = render(
    <GitActionMenu input={rowInput()} anchor={{ x: 10, y: 10 }} onClose={onClose} {...props} />,
  )
  return { ...result, onClose }
}

const item = (name: string | RegExp, section?: string) => {
  const scope = section ? screen.getByRole('group', { name: section }) : document.body
  const matches = [...scope.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((element) =>
    typeof name === 'string' ? element.textContent === name : name.test(element.textContent ?? ''),
  )
  if (matches.length !== 1) throw new Error(`expected one menu item ${name}, found ${matches.length}`)
  return matches[0]!
}

describe('GitActionMenu', () => {
  test('a row lists the commit, then every ref on it, each as a labelled group', () => {
    renderMenu()
    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      'commit abc1234',
      'branch main',
      'branch feature',
      'tag v1.0',
    ])
  })

  test('a host that wires no checkout handler still gets every checkout entry, disabled with a reason', () => {
    renderMenu()
    for (const [name, section] of [
      ['Checkout commit (detached HEAD)', 'commit abc1234'],
      ['Checkout branch', 'branch feature'],
      ['Checkout tag (detached HEAD)', 'tag v1.0'],
    ] as const) {
      const entry = item(name, section)
      expect(entry.getAttribute('aria-disabled')).toBe('true')
      expect(entry.getAttribute('title')).toContain('is not offered in this view')
    }
    // The same goes for the link entries with no URL builder.
    expect(item('Open commit in a new tab').getAttribute('title')).toContain('not offered')
  })

  test('the checked-out branch keeps its checkout entry, disabled with the state’s reason', () => {
    const onCheckout = mock(() => {})
    renderMenu({ onCheckout })
    const entry = item('Checkout branch', 'branch main')
    expect(entry.getAttribute('aria-disabled')).toBe('true')
    expect(entry.getAttribute('title')).toBe('main is already checked out')
    fireEvent.click(entry)
    expect(onCheckout).not.toHaveBeenCalled()
  })

  test('a checkout entry only requests the checkout from the host, then closes', () => {
    const onCheckout = mock(() => {})
    const { onClose } = renderMenu({ onCheckout })
    fireEvent.click(item('Checkout branch', 'branch feature'))
    expect(onCheckout).toHaveBeenCalledWith({ kind: 'branch', name: 'feature' })
    expect(onClose).toHaveBeenCalled()

    fireEvent.click(item('Checkout tag (detached HEAD)', 'tag v1.0'))
    expect(onCheckout).toHaveBeenLastCalledWith({ kind: 'tag', name: 'v1.0' })

    fireEvent.click(item('Checkout commit (detached HEAD)'))
    expect(onCheckout).toHaveBeenLastCalledWith({ kind: 'commit', hash: FULL_HASH })
  })

  test('open-commit and compare are links built by the host, opening a new tab', () => {
    renderMenu({
      buildCommitHref: (target) => `/commit?hash=${target.hash}`,
      buildCompareHref: (branchName) => `/compare?head=${branchName}`,
    })
    const openCommit = item('Open commit in a new tab')
    expect(openCommit.tagName).toBe('A')
    expect(openCommit.getAttribute('href')).toBe('/commit?hash=abc1234')
    expect(openCommit.getAttribute('target')).toBe('_blank')
    expect(item('Compare against the default branch', 'branch feature').getAttribute('href')).toBe(
      '/compare?head=feature',
    )
    // The default branch is not compared against itself — still there, disabled.
    const compareMain = item('Compare against the default branch', 'branch main')
    expect(compareMain.tagName).toBe('BUTTON')
    expect(compareMain.getAttribute('title')).toContain('is the default branch')
  })

  test('keyboard: focus starts on the first entry, arrows move and wrap, Enter invokes, Escape closes', () => {
    const onCheckout = mock(() => {})
    const { onClose } = renderMenu({ onCheckout })
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0]!)

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items.at(-1)!)
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0]!)
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(items.at(-1)!)
    fireEvent.keyDown(menu, { key: 'Home' })

    // The first entry is "Checkout commit (detached HEAD)".
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onCheckout).toHaveBeenCalledWith({ kind: 'commit', hash: FULL_HASH })

    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('the keys it handles do not reach the host’s own shortcuts', () => {
    const hostKeys: string[] = []
    const listener = (event: KeyboardEvent) => hostKeys.push(event.key)
    window.addEventListener('keydown', listener)
    renderMenu()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    window.removeEventListener('keydown', listener)
    expect(hostKeys).toEqual([])
  })

  test('a pointer press outside closes it; one inside does not', () => {
    const { onClose } = renderMenu()
    fireEvent.pointerDown(screen.getByRole('menu'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('GitActionMenu copy entries', () => {
  // Installed per test and restored, exactly like CommitDetailPanel's copy tests:
  // a leaked fake clipboard would make later CopyButton tests order-dependent.
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  let written: string[] = []
  beforeEach(() => {
    written = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void written.push(text) },
      configurable: true,
    })
  })
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else delete (navigator as { clipboard?: unknown }).clipboard
  })

  test('copies the full and the short hash, and reports it', async () => {
    const onNotice = mock(() => {})
    renderMenu({ onNotice })
    await act(async () => {
      fireEvent.click(item('Copy commit hash'))
    })
    await act(async () => {
      fireEvent.click(item('Copy short hash'))
    })
    expect(written).toEqual([FULL_HASH, 'abc1234'])
    expect(onNotice).toHaveBeenCalledWith({ tone: 'success', text: `Copied commit hash ${FULL_HASH}` })
  })
})
