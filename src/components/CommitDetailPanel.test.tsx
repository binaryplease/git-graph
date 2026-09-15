import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  remotes: [],
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

describe('CommitDetailPanel host open-file-diff seam', () => {
  /** The row's open-diff control, whose accessible name is `open <path> diff`. */
  const openDiffButtonFor = (filePath: string) =>
    screen.getByRole('button', { name: `open ${filePath} diff` })

  /** The row's inline-disclosure toggle — the button that carries aria-expanded. */
  const inlineToggleFor = (filePath: string) => {
    const match = screen
      .getAllByRole('button', {
        name: new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
      .find((button) => button.hasAttribute('aria-expanded'))
    if (match === undefined) throw new Error(`no inline toggle for ${filePath}`)
    return match
  }

  test('with the seam the per-file control is a button that fires with the path, not a link', () => {
    const openedPaths: string[] = []
    const { toggled } = renderPanel({ onOpenFileDiff: (filePath) => openedPaths.push(filePath) })

    // The host owns the destination, so it is an enabled button, not a new-tab link.
    expect(screen.queryByRole('link', { name: /src\/App\.tsx diff/ })).toBeNull()
    fireEvent.click(openDiffButtonFor('src/App.tsx'))
    expect(openedPaths).toEqual(['src/App.tsx'])
    // The seam is distinct from the inline-diff disclosure.
    expect(toggled).toEqual([])
  })

  test('a binary row still shows no open-diff control — nothing to diff', () => {
    renderPanel({ onOpenFileDiff: () => {} })
    expect(screen.queryByRole('button', { name: /assets\/logo\.png diff/ })).toBeNull()
  })

  test('cmd/ctrl-clicking a row routes to the callback and opens no tab', () => {
    const openedPaths: string[] = []
    const openedUrls: string[] = []
    const { toggled } = renderPanel({ onOpenFileDiff: (filePath) => openedPaths.push(filePath) })
    const originalOpen = window.open
    window.open = ((url?: string | URL) => {
      openedUrls.push(String(url))
      return null
    }) as typeof window.open
    try {
      fireEvent.click(inlineToggleFor('src/App.tsx'), { metaKey: true })
      fireEvent.click(inlineToggleFor('src/App.tsx'), { ctrlKey: true })
    } finally {
      window.open = originalOpen
    }
    expect(openedPaths).toEqual(['src/App.tsx', 'src/App.tsx'])
    // The seam takes precedence over the href, so no new tab and no toggle.
    expect(openedUrls).toEqual([])
    expect(toggled).toEqual([])
  })
})

describe('CommitDetailPanel host open-file seam', () => {
  /** The open-file control's accessible name is `open <path>`, exactly. */
  const openFileControlFor = (filePath: string) =>
    screen.getByRole('button', { name: `open ${filePath}` })

  test('no open-file control without the seam (default standalone render)', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: 'open src/App.tsx' })).toBeNull()
  })

  test('onOpenFile fires with the file and does not toggle the inline diff', () => {
    const opened: CommitFileChange[] = []
    const { toggled } = renderPanel({ onOpenFile: (file) => opened.push(file) })

    fireEvent.click(openFileControlFor('src/App.tsx'))

    expect(opened).toHaveLength(1)
    expect(opened[0]?.path).toBe('src/App.tsx')
    // The seam is distinct from the row's inline-diff disclosure — opening the
    // file never asks the host to toggle the diff.
    expect(toggled).toEqual([])
  })

  test('the seam control is offered on every row, binary included', () => {
    renderPanel({ onOpenFile: () => {} })
    // A binary row has no diff to open, but the host can still open the file.
    expect(screen.getByRole('button', { name: 'open assets/logo.png' })).toBeTruthy()
  })
})

describe('CommitDetailPanel layout variant', () => {
  test('the default (sidebar) variant renders as an aside', () => {
    renderPanel()
    const panel = screen.getByLabelText('Commit details')
    expect(panel.tagName).toBe('ASIDE')
  })

  test('the inline variant renders the same detail in a section frame', () => {
    renderPanel({ variant: 'inline' })
    const panel = screen.getByLabelText('Commit details')
    expect(panel.tagName).toBe('SECTION')
    // Same content invariant either way — the changed files still render.
    expect(toggleFor('src/App.tsx')).toBeTruthy()
  })

  test('the sidebar variant heads the panel with the commit subject', () => {
    renderPanel({ variant: 'sidebar' })
    expect(screen.getByRole('heading', { name: 'a commit' })).toBeTruthy()
  })

  test('the inline variant omits the subject heading — the row above already shows it', () => {
    renderPanel({ variant: 'inline' })
    // No duplicated title: the commit row that this block sits beneath owns it.
    expect(screen.queryByRole('heading', { name: 'a commit' })).toBeNull()
    // The close control still renders — floated in the top-right corner here.
    expect(screen.getByRole('button', { name: 'Close the details panel' })).toBeTruthy()
  })

  test('headerActions render in the panel header alongside the close button', () => {
    renderPanel({ headerActions: <button type="button">layout toggle</button> })
    expect(screen.getByRole('button', { name: 'layout toggle' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close the details panel' })).toBeTruthy()
  })

  test('inline still surfaces headerActions and close in its floating corner cluster', () => {
    renderPanel({ variant: 'inline', headerActions: <button type="button">layout toggle</button> })
    expect(screen.getByRole('button', { name: 'layout toggle' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close the details panel' })).toBeTruthy()
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

  test('the open-commit-diff seam takes precedence over the href with an enabled button', () => {
    const opened: string[] = []
    renderPanel({ onOpenCommitDiff: () => opened.push('commit') })
    // A button, not a new-tab link.
    expect(screen.queryByRole('link', { name: /full diff/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: "open this commit's full diff" }))
    expect(opened).toEqual(['commit'])
  })

  test('the open-compare seam takes precedence with a button carrying the branch name', () => {
    const compared: string[] = []
    renderPanel({
      detail: { ...commitDetail, refs: ['HEAD -> feature', 'tag: v1.0'] },
      onOpenCompare: (branchName) => compared.push(branchName),
    })
    // A button, not a new-tab link; tags stay uncomparable.
    expect(screen.queryByRole('link', { name: /compare feature against/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /compare v1\.0 against/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /compare feature against the default branch/i }))
    expect(compared).toEqual(['feature'])
  })
})

const pillTexts = () =>
  [...document.querySelectorAll('.ref-pill')].map((pill) => pill.textContent ?? '')
const remoteSegments = () =>
  [...document.querySelectorAll('.ref-segment-remote')].map((segment) => segment.textContent ?? '')

// The panel is the second surface that renders ref pills, and it groups them
// from the same shared function the graph rows use — the detail payload carries
// the repository's remote names for exactly this.
describe('CommitDetailPanel ref pills', () => {
  test('a branch and its remotes on this commit render one segmented pill per remote', () => {
    renderPanel({
      detail: {
        ...commitDetail,
        refs: ['HEAD -> main', 'origin/main', 'upstream/main', 'tag: v1.0'],
        remotes: ['origin', 'upstream'],
      },
    })
    // The same rendering the graph rows show: segments, no `HEAD -> `, no glyph.
    expect(pillTexts()).toEqual(['main origin upstream', 'v1.0'])
    expect(remoteSegments()).toEqual(['origin', 'upstream'])
    const [headPill] = [...document.querySelectorAll('.ref-pill')]
    expect(headPill!.className).toContain('ref-checked-out')
    expect(document.body.innerHTML).not.toContain('HEAD -&gt;')
    // A merged badge stays a checkable claim: the tooltip names its refs.
    expect(headPill!.getAttribute('title')).toBe(
      'local branch main (checked out) — in sync with origin/main, upstream/main',
    )
  })

  test('a detached HEAD keeps its own pill and no checked-out state', () => {
    renderPanel({
      detail: { ...commitDetail, refs: ['HEAD', 'main'], remotes: ['origin'] },
    })
    expect(pillTexts()).toEqual(['HEAD', 'main'])
    const [headPill] = [...document.querySelectorAll('.ref-pill')]
    expect(headPill!.className).toContain('ref-head')
    expect(headPill!.className).not.toContain('ref-checked-out')
  })

  test('the unified pill keeps the compare affordance, once, under the bare branch name', () => {
    renderPanel({
      detail: {
        ...commitDetail,
        refs: ['HEAD -> feature', 'origin/feature'],
        remotes: ['origin'],
      },
    })
    expect(pillTexts()).toEqual(['feature origin'])
    const compareLinks = screen.getAllByRole('link', {
      name: /compare feature against the default branch/i,
    }) as HTMLAnchorElement[]
    expect(compareLinks).toHaveLength(1)
    expect(compareLinks[0]!.getAttribute('href')).toBe('/compare?repo=demo&head=feature')
  })

  test('a diverged remote keeps its own pill and is not comparable', () => {
    renderPanel({
      detail: { ...commitDetail, refs: ['origin/feature'], remotes: ['origin'] },
    })
    expect(pillTexts()).toEqual(['origin/feature'])
    expect(screen.queryByRole('link', { name: /compare .* against the default branch/i })).toBeNull()
    // The copy control stays on the pill (ADR-0025) and offers the ref as it is
    // shown, remote and all.
    expect(screen.getByRole('button', { name: /ref name/i })).toBeTruthy()
  })
})

// What the copy control actually puts on the clipboard, read off a stubbed
// Clipboard API rather than off a prop — the requirement is that the user ends
// up holding a ref `git` can look up.
describe('CommitDetailPanel ref copy value', () => {
  const copyRefName = async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void written.push(text) },
      configurable: true,
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ref name/i }))
    })
    return written
  }

  // Regression: the pill drops the remote qualifier for a name that lives on
  // several remotes and nowhere locally, and the copy value used to be read
  // straight off that label — handing over a bare `shared`, which resolves to
  // nothing. Before ref grouping existed it copied `origin/shared`.
  test('a name on several remotes but no local branch copies a ref that resolves', async () => {
    renderPanel({
      detail: {
        ...commitDetail,
        refs: ['origin/shared', 'upstream/shared'],
        remotes: ['origin', 'upstream'],
      },
    })
    // The pill still reads `shared`, with both remotes as segments.
    expect(pillTexts()).toEqual(['shared origin upstream'])
    expect(await copyRefName()).toEqual(['origin/shared'])
  })

  test('a local branch copies its own name, not its remotes', async () => {
    renderPanel({
      detail: { ...commitDetail, refs: ['HEAD -> main', 'origin/main'], remotes: ['origin'] },
    })
    expect(pillTexts()).toEqual(['main origin'])
    expect(await copyRefName()).toEqual(['main'])
  })
})
