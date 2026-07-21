import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CommitFileChange, FileDiff } from '../../shared/git.schema'
import { MultiFileDiffView } from './MultiFileDiffView'

// The multi-file view lists every changed file on top and loads each file's diff
// lazily as its section nears the viewport. The lazy trigger is an
// IntersectionObserver; the test DOM defines one but never fires it, so a fake
// that intersects immediately stands in — that is exactly the moment a real
// section would begin loading.

let realObserver: typeof IntersectionObserver
beforeAll(() => {
  realObserver = globalThis.IntersectionObserver
  class ImmediateObserver {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(element: Element) {
      this.callback([{ isIntersecting: true, target: element } as IntersectionObserverEntry], this as never)
    }
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return []
    }
  }
  globalThis.IntersectionObserver = ImmediateObserver as unknown as typeof IntersectionObserver
})
afterAll(() => {
  globalThis.IntersectionObserver = realObserver
})
afterEach(cleanup)

const textFile: CommitFileChange = {
  path: 'src/x.ts',
  previousPath: null,
  status: 'modified',
  additions: 2,
  deletions: 1,
  binary: false,
}
const binaryFile: CommitFileChange = {
  path: 'img.png',
  previousPath: null,
  status: 'added',
  additions: null,
  deletions: null,
  binary: true,
}

/** A diff with no hunks renders a plain notice — no syntax highlighter needed. */
const noHunksDiff = (file: CommitFileChange): FileDiff => ({
  path: file.path,
  previousPath: null,
  status: file.status,
  hunks: [],
  oldSource: null,
  newSource: null,
  language: 'txt',
  binary: false,
  truncated: false,
})

describe('MultiFileDiffView', () => {
  test('lists every file with a jump link and loads text diffs lazily', async () => {
    const requested: string[] = []
    const loadFileDiff = (file: CommitFileChange) => {
      requested.push(file.path)
      return Promise.resolve(noHunksDiff(file))
    }

    render(
      <MultiFileDiffView
        files={[textFile, binaryFile]}
        filesTruncated={false}
        loadFileDiff={loadFileDiff}
        emptyMessage="no changes"
      />,
    )

    // The file list on top: one jump link per file, pointing at its section.
    expect(screen.getByRole('link', { name: /src\/x\.ts/ }).getAttribute('href')).toBe('#file-0')
    expect(screen.getByRole('link', { name: /img\.png/ }).getAttribute('href')).toBe('#file-1')

    // The text file's diff is fetched once its section intersects; the binary
    // file is short-circuited — there is nothing to fetch.
    await waitFor(() => expect(screen.getByText(/No textual changes/)).toBeTruthy())
    expect(requested).toEqual(['src/x.ts'])
    expect(screen.getByText('Binary file — git reports no line-by-line diff.')).toBeTruthy()
  })

  // The seam is independent of the lazy diff load, so these use the binary
  // fixture — no diff to fetch, no async load to settle around the assertion.
  test('with no onOpenFile there is no open-file control (default standalone render)', () => {
    render(
      <MultiFileDiffView
        files={[binaryFile]}
        filesTruncated={false}
        loadFileDiff={() => Promise.reject(new Error('should not be called'))}
        emptyMessage="no changes"
      />,
    )
    expect(screen.queryByRole('button', { name: 'open img.png' })).toBeNull()
  })

  test('a host onOpenFile adds a distinct control that fires with the file, leaving the jump link intact', () => {
    const opened: CommitFileChange[] = []
    render(
      <MultiFileDiffView
        files={[binaryFile]}
        filesTruncated={false}
        loadFileDiff={() => Promise.reject(new Error('should not be called'))}
        emptyMessage="no changes"
        onOpenFile={(file) => opened.push(file)}
      />,
    )

    // The seam is a separate control from the file-name jump link, so activating
    // it opens the file without ever touching the anchor's in-diff scroll.
    const openControl = screen.getByRole('button', { name: 'open img.png' })
    fireEvent.click(openControl)
    expect(opened).toEqual([binaryFile])

    const jumpLink = screen.getByRole('link', { name: /img\.png/ })
    expect(jumpLink.getAttribute('href')).toBe('#file-0')
  })

  // A host that opens the change set focused on one file passes focusFilePath;
  // the view scrolls that file's section into view. Binary fixtures keep the
  // lazy diff load out of the assertion.
  const secondBinaryFile: CommitFileChange = { ...binaryFile, path: 'other.png' }

  test('focusFilePath scrolls the matching section into view', () => {
    const scrolledIds: string[] = []
    const originalScroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledIds.push(this.id)
    }
    try {
      render(
        <MultiFileDiffView
          files={[binaryFile, secondBinaryFile]}
          filesTruncated={false}
          loadFileDiff={() => Promise.reject(new Error('should not be called'))}
          emptyMessage="no changes"
          focusFilePath="other.png"
        />,
      )
    } finally {
      Element.prototype.scrollIntoView = originalScroll
    }
    // The section id is derived from the file's index in the list.
    expect(scrolledIds).toEqual(['file-1'])
  })

  test('focusFilePath that matches no file is a no-op', () => {
    const scrolledIds: string[] = []
    const originalScroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledIds.push(this.id)
    }
    try {
      render(
        <MultiFileDiffView
          files={[binaryFile]}
          filesTruncated={false}
          loadFileDiff={() => Promise.reject(new Error('should not be called'))}
          emptyMessage="no changes"
          focusFilePath="nowhere.png"
        />,
      )
    } finally {
      Element.prototype.scrollIntoView = originalScroll
    }
    expect(scrolledIds).toEqual([])
  })

  test('renders the empty message when nothing changed', () => {
    render(
      <MultiFileDiffView
        files={[]}
        filesTruncated={false}
        loadFileDiff={() => Promise.reject(new Error('should not be called'))}
        emptyMessage="This commit changed no files."
      />,
    )
    expect(screen.getByText('This commit changed no files.')).toBeTruthy()
  })
})
