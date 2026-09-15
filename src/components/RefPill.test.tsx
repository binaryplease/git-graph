import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { groupRefDecorations } from '../../shared/refGroup'
import { CommitRefRow } from './RefPill'

// `CommitRefRow` is the unit a surface renders for a commit row's refs, and the
// reason it is the unit rather than the ring and the pills separately is that
// the *arrangement* is the invariant (ADR-0027 Rule 1): the ring carries no
// name on screen, so it only means "checked out" while it sits immediately
// before the pills it qualifies. These tests pin that adjacency, not the
// markup around it — a surface that re-placed the ring would still render both
// elements and still be wrong.

afterEach(cleanup)

const ringOf = (container: HTMLElement) => container.querySelector('.ref-head-dot')
const pillsOf = (container: HTMLElement) => [...container.querySelectorAll('.ref-pill')]

describe('CommitRefRow', () => {
  test('the ring sits in the same line as the pills, immediately before the first one', () => {
    const { container } = render(
      <CommitRefRow
        groups={groupRefDecorations(['HEAD -> main', 'origin/main', 'tag: v1.0'], ['origin'])}
        laneColor="var(--lane-3)"
      />,
    )
    const ring = ringOf(container)
    const pills = pillsOf(container)
    expect(ring).not.toBeNull()
    expect(pills.map((pill) => pill.textContent)).toEqual(['main origin', 'v1.0'])
    // One line, one cluster: the ring is not in a box of its own beside them.
    expect(ring!.parentElement).toBe(pills[0]!.parentElement)
    // And it leads — a ring trailing the pills would qualify the wrong ref.
    expect(ring!.nextElementSibling).toBe(pills[0]!)
  })

  test('the ring names the checked-out branch without being told which it is', () => {
    const { container } = render(
      <CommitRefRow
        groups={groupRefDecorations(['origin/topic', 'HEAD -> topic'], ['origin'])}
        laneColor="var(--lane-3)"
      />,
    )
    const description = 'The branch "topic" is currently checked out at this commit.'
    // Derived here from the groups, so no surface can derive it differently.
    expect(ringOf(container)!.getAttribute('title')).toBe(description)
    expect(ringOf(container)!.getAttribute('aria-label')).toBe(description)
  })

  test('the ring adopts the row lane colour it is given', () => {
    const { container } = render(
      <CommitRefRow
        groups={groupRefDecorations(['HEAD -> main'], [])}
        laneColor="var(--lane-7)"
      />,
    )
    expect(ringOf(container)!.getAttribute('style')).toContain('var(--lane-7)')
  })

  test('a detached HEAD is on no branch, so the row is unringed and the pill speaks', () => {
    const { container } = render(
      <CommitRefRow groups={groupRefDecorations(['HEAD', 'main'], [])} laneColor="var(--lane-0)" />,
    )
    expect(ringOf(container)).toBeNull()
    expect(pillsOf(container).map((pill) => pill.textContent)).toEqual(['HEAD', 'main'])
  })

  test('a branch with no HEAD on it is unringed', () => {
    const { container } = render(
      <CommitRefRow groups={groupRefDecorations(['feature'], [])} laneColor="var(--lane-0)" />,
    )
    expect(ringOf(container)).toBeNull()
    expect(pillsOf(container)).toHaveLength(1)
  })

  // An undecorated commit must contribute nothing to its row — not an empty
  // box that still consumes the row's gap and shifts the subject.
  test('no refs renders nothing at all', () => {
    const { container } = render(<CommitRefRow groups={[]} laneColor="var(--lane-0)" />)
    expect(container.innerHTML).toBe('')
  })
})
