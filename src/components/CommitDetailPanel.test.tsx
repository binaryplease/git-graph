import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CommitDetail, CommitFileChange } from '../../shared/git.schema'
import { CommitDetailPanel } from './CommitDetailPanel'

// The disclosure contract of the file rows: clicking a row opens that file's
// diff and asks the host to fetch it, clicking it again closes it, and a binary
// row keeps its control but cannot be opened (ADR-0025).

afterEach(cleanup)

const fileChange = (overrides: Partial<CommitFileChange>): CommitFileChange => ({
  path: 'src/App.tsx',
  previousPath: null,
  status: 'modified',
  additions: 3,
  deletions: 1,
  binary: false,
  ...overrides,
})

const commitDetail: CommitDetail = {
  hash: 'abc1234',
  fullHash: 'abc1234000000000000000000000000000000000',
  parents: [],
  refs: [],
  author: 'Test',
  authorEmail: 'test@example.invalid',
  authorDate: '2026-07-20T10:00:00+02:00',
  committer: 'Test',
  committerEmail: 'test@example.invalid',
  committerDate: '2026-07-20T10:00:00+02:00',
  subject: 'a commit',
  body: '',
  files: [fileChange({}), fileChange({ path: 'assets/logo.png', binary: true, additions: null, deletions: null, status: 'added' })],
  filesTruncated: false,
}

function renderPanel(overrides: Partial<Parameters<typeof CommitDetailPanel>[0]> = {}) {
  const toggled: string[] = []
  render(
    <CommitDetailPanel
      detail={commitDetail}
      isLoading={false}
      error={null}
      requestedHash="abc1234"
      onSelectCommit={() => {}}
      isCommitLoaded={() => true}
      expandedFilePath={null}
      onToggleFile={(filePath) => toggled.push(filePath)}
      buildFileDiffHref={(filePath) => `/diff?repo=demo&hash=abc1234&path=${encodeURIComponent(filePath)}`}
      buildCommitDiffHref={() => '/commit?repo=demo&hash=abc1234'}
      buildCompareHref={(branchName) =>
        branchName === 'main' ? null : `/compare?repo=demo&head=${encodeURIComponent(branchName)}`
      }
      fileDiff={null}
      isLoadingFileDiff={false}
      fileDiffError={null}
      onClose={() => {}}
      {...overrides}
    />,
  )
  return { toggled }
}

/** The row's toggle is the button whose accessible name names the file. */
const toggleFor = (filePath: string) =>
  screen.getByRole('button', { name: new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })

describe('CommitDetailPanel file disclosure', () => {
  test('a collapsed row renders no diff body and reports collapsed state', () => {
    renderPanel()
    const toggle = toggleFor('src/App.tsx')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/Loading diff/)).toBeNull()
  })

  test('clicking a row asks the host to open that file', () => {
    const { toggled } = renderPanel()
    fireEvent.click(toggleFor('src/App.tsx'))
    expect(toggled).toEqual(['src/App.tsx'])
  })

  test('the expanded row shows the loading state while the host fetches', () => {
    renderPanel({ expandedFilePath: 'src/App.tsx', isLoadingFileDiff: true })
    expect(toggleFor('src/App.tsx').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Loading diff…')).toBeTruthy()
  })

  test('clicking the expanded row again asks the host to close it', () => {
    const { toggled } = renderPanel({ expandedFilePath: 'src/App.tsx' })
    fireEvent.click(toggleFor('src/App.tsx'))
    // The host owns the toggle semantics; the panel just reports the same path.
    expect(toggled).toEqual(['src/App.tsx'])
  })

  test('a fetch failure is reported in place of the diff', () => {
    renderPanel({ expandedFilePath: 'src/App.tsx', fileDiffError: 'git show failed' })
    expect(screen.getByText('git show failed')).toBeTruthy()
  })

  test('a binary row keeps a visible but disabled toggle that explains itself', () => {
    renderPanel()
    const toggle = toggleFor('assets/logo.png') as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    expect(toggle.getAttribute('title')).toContain('binary')
    fireEvent.click(toggle)
    expect(screen.queryByText(/Loading diff/)).toBeNull()
  })

  test('only the expanded file gets a diff body', () => {
    renderPanel({ expandedFilePath: 'src/App.tsx', isLoadingFileDiff: true })
    expect(screen.getAllByText('Loading diff…')).toHaveLength(1)
  })
})

describe('CommitDetailPanel open-in-new-tab affordance', () => {
  /** The row's visible new-tab control is the link naming the file. */
  const openLinkFor = (filePath: string) =>
    screen.getByRole('link', {
      name: new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    })

  test('a non-binary row exposes a new-tab link to that file’s diff route', () => {
    renderPanel()
    const link = openLinkFor('src/App.tsx') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/diff?repo=demo&hash=abc1234&path=src%2FApp.tsx')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  test('cmd/ctrl-clicking a row opens the diff in a new tab instead of toggling', () => {
    const { toggled } = renderPanel()
    const openedUrls: string[] = []
    const originalOpen = window.open
    window.open = ((url?: string | URL) => {
      openedUrls.push(String(url))
      return null
    }) as typeof window.open
    try {
      fireEvent.click(toggleFor('src/App.tsx'), { metaKey: true })
      fireEvent.click(toggleFor('src/App.tsx'), { ctrlKey: true })
    } finally {
      window.open = originalOpen
    }
    expect(openedUrls).toEqual([
      '/diff?repo=demo&hash=abc1234&path=src%2FApp.tsx',
      '/diff?repo=demo&hash=abc1234&path=src%2FApp.tsx',
    ])
    // A modified click must not also toggle the inline disclosure.
    expect(toggled).toEqual([])
  })

  test('a plain click still toggles inline and opens no tab', () => {
    const { toggled } = renderPanel()
    const openedUrls: string[] = []
    const originalOpen = window.open
    window.open = ((url?: string | URL) => {
      openedUrls.push(String(url))
      return null
    }) as typeof window.open
    try {
      fireEvent.click(toggleFor('src/App.tsx'))
    } finally {
      window.open = originalOpen
    }
    expect(openedUrls).toEqual([])
    expect(toggled).toEqual(['src/App.tsx'])
  })

  test('a binary row offers no new-tab link — nothing to diff', () => {
    renderPanel()
    expect(screen.queryByRole('link', { name: /assets\/logo\.png/ })).toBeNull()
  })
})

describe('CommitDetailPanel full-commit and compare affordances', () => {
  test('the file list links to the whole commit’s diff in a new tab', () => {
    renderPanel()
    const link = screen.getByRole('link', { name: /full diff in a new tab/i }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/commit?repo=demo&hash=abc1234')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  test('a non-default branch ref offers a compare link; the default branch does not', () => {
    renderPanel({
      detail: { ...commitDetail, refs: ['HEAD -> feature', 'main', 'tag: v1.0'] },
    })
    const compareLink = screen.getByRole('link', {
      name: /compare feature against the default branch/i,
    }) as HTMLAnchorElement
    expect(compareLink.getAttribute('href')).toBe('/compare?repo=demo&head=feature')
    // The default branch (main) and the tag are not comparable, so no link.
    expect(screen.queryByRole('link', { name: /compare main against/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /compare v1\.0 against/i })).toBeNull()
  })
})
