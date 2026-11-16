import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GRAPH_VIEW_STORAGE_KEY, parseStoredGraphViewSettings, useGraphView } from './graphView'
import { GraphViewToggle, TagsAsRowsToggle } from '../components/GraphViewToggle'

// The Branches | Commits switch and the Tags-as-rows toggle, persisted app-only
// (ADR-0029): Commits is the default, a stored choice survives a remount, and a
// stored value that fails validation falls back to the default.

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('parseStoredGraphViewSettings', () => {
  test('nothing stored resolves to the Commits view with tags off', () => {
    expect(parseStoredGraphViewSettings(null)).toEqual({ view: 'commits', tagsAsRows: false })
  })

  test('a valid stored value is kept', () => {
    expect(parseStoredGraphViewSettings('{"view":"branches","tagsAsRows":true}')).toEqual({
      view: 'branches',
      tagsAsRows: true,
    })
  })

  test('a value that fails validation falls back field by field, never throws', () => {
    expect(parseStoredGraphViewSettings('{"view":"timeline","tagsAsRows":"yes"}')).toEqual({
      view: 'commits',
      tagsAsRows: false,
    })
    expect(parseStoredGraphViewSettings('{"view":"branches"}')).toEqual({ view: 'branches', tagsAsRows: false })
    expect(parseStoredGraphViewSettings('not json')).toEqual({ view: 'commits', tagsAsRows: false })
    expect(parseStoredGraphViewSettings('42')).toEqual({ view: 'commits', tagsAsRows: false })
  })
})

/** The app's header controls, wired to the hook the way App.tsx wires them. */
function Harness() {
  const { graphView, setGraphView, tagsAsRows, setTagsAsRows } = useGraphView()
  return (
    <>
      <GraphViewToggle graphView={graphView} onSelectGraphView={setGraphView} />
      <TagsAsRowsToggle tagsAsRows={tagsAsRows} onToggle={setTagsAsRows} applies={graphView === 'branches'} />
      <output>{graphView}</output>
    </>
  )
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('the view switch', () => {
  test('Commits is the default view', () => {
    render(<Harness />)
    expect(pressed('Commits')).toBe('true')
    expect(pressed('Branches')).toBe('false')
  })

  test('the chosen view and the tags toggle persist across a remount', () => {
    const first = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Branches' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tags as rows' }))
    expect(JSON.parse(window.localStorage.getItem(GRAPH_VIEW_STORAGE_KEY)!)).toEqual({
      view: 'branches',
      tagsAsRows: true,
    })
    first.unmount()
    render(<Harness />)
    expect(pressed('Branches')).toBe('true')
    expect(pressed('Tags as rows')).toBe('true')
  })

  test('a stored value that fails validation opens the Commits view', () => {
    window.localStorage.setItem(GRAPH_VIEW_STORAGE_KEY, '{"view":"graph-of-doom"}')
    render(<Harness />)
    expect(screen.getByRole('status').textContent).toBe('commits')
  })

  test('Tags as rows stays visible in the Commits view, explains itself, and does nothing there', () => {
    const onToggle = mock((_next: boolean) => {})
    render(<TagsAsRowsToggle tagsAsRows={false} onToggle={onToggle} applies={false} />)
    const button = screen.getByRole('button', { name: 'Tags as rows' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('title')).toContain('Applies to the Branches view')
    fireEvent.click(button)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
