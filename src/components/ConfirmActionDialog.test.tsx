import { afterEach, describe, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describeCheckout } from '../../shared/gitActions'
import { ConfirmActionDialog } from './ConfirmActionDialog'

// The confirmation is where a git write states what it will do to which
// repository before it runs, and where git's refusal comes back to. Pinned: the
// statement and warnings are on screen before anything runs, nothing runs
// without the confirm, and a refusal is shown verbatim with the dialog still
// there to retry or cancel.

afterEach(cleanup)

const detachDescription = describeCheckout(
  { kind: 'commit', hash: 'abc1234'.padEnd(40, '0') },
  { repositoryName: 'git-graph', hasUncommittedChanges: true },
)

describe('ConfirmActionDialog', () => {
  test('states the command, the repository and every warning before anything runs', () => {
    const onConfirm = mock(() => {})
    render(
      <ConfirmActionDialog
        description={detachDescription}
        isRunning={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('git switch --detach abc1234')
    expect(dialog.textContent).toContain('in git-graph')
    expect(dialog.textContent).toContain('This detaches HEAD')
    expect(dialog.textContent).toContain('uncommitted changes')
    expect(onConfirm).not.toHaveBeenCalled()
    // Focus starts on the confirm, so the keyboard path from the menu is Enter, Enter.
    expect(document.activeElement?.textContent).toBe('Check out and detach')
  })

  test('confirm runs the action; Escape and Cancel do not', () => {
    const onConfirm = mock(() => {})
    const onCancel = mock(() => {})
    render(
      <ConfirmActionDialog
        description={detachDescription}
        isRunning={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check out and detach' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test('shows git’s refusal verbatim and offers to try again', () => {
    const stderr =
      'error: Your local changes to the following files would be overwritten by checkout:\n\ttracked.txt\nAborting'
    render(
      <ConfirmActionDialog
        description={detachDescription}
        isRunning={false}
        error={stderr}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('alert').querySelector('pre')!.textContent).toBe(stderr)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  test('while git runs, neither button acts, and both stay focusable and explain why', () => {
    const onConfirm = mock(() => {})
    const onCancel = mock(() => {})
    render(
      <ConfirmActionDialog
        description={detachDescription}
        isRunning
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    for (const button of screen.getAllByRole('button')) {
      expect(button.hasAttribute('disabled')).toBe(false)
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.getAttribute('title')).toBe('waiting for git to finish')
      fireEvent.click(button)
    }
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
