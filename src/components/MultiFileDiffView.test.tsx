import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
