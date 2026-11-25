import { afterEach, describe, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MergePreview } from '../../shared/git.schema'
import { describeMergeFailure } from '../../shared/gitActions'
import { ConfirmMergeDialog, type ConfirmMergeDialogProps } from './ConfirmMergeDialog'

// The merge's confirmation. Pinned: the Fast Forward option starts unchecked (a
// --no-ff merge commit is the default) and is disabled with its reason when git
// says a fast-forward is not possible; uncommitted changes block the confirm
// with the reason on screen; and a conflict comes back as aborted, with git's
// output shown verbatim.

afterEach(cleanup)

const preview = (overrides: Partial<MergePreview> = {}): MergePreview => ({
  repository: 'git-graph',
  branch: 'x',
  into: 'main',
  alreadyMerged: false,
  canFastForward: true,
  uncommittedFiles: [],
  mergeInProgress: false,
  ...overrides,
})

const renderDialog = (props: Partial<ConfirmMergeDialogProps> = {}) => {
  const onConfirm = mock((_options: { fastForward: boolean }) => {})
  render(
    <ConfirmMergeDialog
      target={{ branch: 'x', into: 'main' }}
      repositoryName="git-graph"
      preview={preview()}
      previewError={null}
      isRunning={false}
      failure={null}
      onConfirm={onConfirm}
      onCancel={() => {}}
      {...props}
    />,
  )
  return { onConfirm }
}

const fastForwardBox = () => screen.getByRole('checkbox', { name: /Fast Forward/ }) as HTMLInputElement
const confirmButton = (name: string) => screen.getByRole('button', { name })

describe('ConfirmMergeDialog', () => {
  test('states the merge, with Fast Forward unchecked: confirming runs a --no-ff merge', () => {
    const { onConfirm } = renderDialog()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Merge x into main?')
    expect(dialog.textContent).toContain('git merge --no-ff --no-edit x in git-graph')
    expect(fastForwardBox().checked).toBe(false)
    expect(fastForwardBox().disabled).toBe(false)
    fireEvent.click(confirmButton('Merge'))
    expect(onConfirm).toHaveBeenCalledWith({ fastForward: false })
  })

  test('checking Fast Forward states and runs a fast-forward only', () => {
    const { onConfirm } = renderDialog()
    fireEvent.click(fastForwardBox())
    expect(fastForwardBox().checked).toBe(true)
    expect(screen.getByRole('alertdialog').textContent).toContain('git merge --ff-only x')
    fireEvent.click(confirmButton('Fast-forward'))
    expect(onConfirm).toHaveBeenCalledWith({ fastForward: true })
  })

  test('Fast Forward is disabled, unchecked, with its reason, when a fast-forward is not possible', () => {
    renderDialog({ preview: preview({ canFastForward: false }) })
    const box = fastForwardBox()
    expect(box.checked).toBe(false)
    expect(box.disabled).toBe(true)
    expect(box.getAttribute('title')).toBe('main has commits that x does not, so a fast-forward is not possible')
    // The reason is on screen too, not only in a tooltip.
    expect(box.closest('label')!.textContent).toContain('a fast-forward is not possible')
  })

  test('uncommitted changes block the merge: the reason is shown and the confirm does nothing', () => {
    const { onConfirm } = renderDialog({ preview: preview({ uncommittedFiles: ['tracked.txt'] }) })
    const reason = 'main has uncommitted changes to 1 tracked file (tracked.txt) — commit or stash them before merging'
    expect(screen.getByRole('alertdialog').textContent).toContain(reason)
    const confirm = confirmButton('Merge')
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    expect(confirm.getAttribute('title')).toBe(reason)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  test('nothing to merge, and a preview still loading, block the confirm too', () => {
    renderDialog({ preview: preview({ alreadyMerged: true, canFastForward: false }) })
    expect(confirmButton('Merge').getAttribute('title')).toBe('main already contains x — there is nothing to merge')
    cleanup()
    renderDialog({ preview: null })
    expect(confirmButton('Merge').getAttribute('aria-disabled')).toBe('true')
    expect(fastForwardBox().disabled).toBe(true)
  })

  test('a conflict is shown as aborted, with git’s output verbatim', () => {
    const gitOutput =
      'Auto-merging conflict.txt\nCONFLICT (content): Merge conflict in conflict.txt\n' +
      'Automatic merge failed; fix conflicts and then commit the result.'
    renderDialog({
      failure: describeMergeFailure({ error: 'Merging x into main conflicted …', reason: 'conflict-aborted', gitOutput }),
    })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('The merge conflicted and was aborted')
    expect(alert.querySelector('pre')!.textContent).toBe(gitOutput)
  })
})
