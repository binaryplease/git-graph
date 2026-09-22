import { useEffect, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { IconAlertTriangle, IconLoader2 } from '@tabler/icons-react'
import type { GitActionDescription } from '../../shared/gitActions'

// The step between choosing a git write and running it (issue #2: "every
// mutating action states what it will do to which repo before it runs"). The
// wording comes from `git-graph/shared` (`describeCheckout`), so a host confirms
// in the same words; this is the one frame around it (ADR-0026). Fetch-free: the
// host runs the action on confirm and hands back `isRunning` and, when git
// refuses, its stderr as `error` — shown verbatim, in place, so the user reads
// git's reason and can retry or cancel without losing the context.

export type ConfirmActionDialogProps = {
  /** What will run, against which repository, and what it will cost. */
  description: GitActionDescription
  /** True while the host is running the action; both buttons wait. */
  isRunning: boolean
  /** Why the last attempt failed — git's stderr for a refusal — or null. */
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmActionDialog({ description, isRunning, error, onConfirm, onCancel }: ConfirmActionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Focus starts on the confirming button so the keyboard path from the menu is
  // Enter, then Enter; it returns to wherever it was (the row) when the dialog
  // goes away.
  useEffect(() => {
    const previouslyFocused = document.activeElement
    confirmRef.current?.focus()
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!isRunning) onCancel()
      return
    }
    // Keep Tab inside the dialog while it is modal.
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // While git runs the buttons are aria-disabled rather than `disabled`: a
  // disabled button drops focus to <body>, and the keyboard user would lose the
  // dialog (and its Escape) the moment they confirmed.
  const buttonClass =
    'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1 text-[12.5px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="git-action-dialog-title"
        aria-describedby="git-action-dialog-summary"
        className="w-full max-w-lg rounded-lg border border-line bg-raised p-4 font-sans text-[13px] text-fg shadow-2xl shadow-black/60"
        onKeyDown={handleKeyDown}
      >
        <h2 id="git-action-dialog-title" className="text-[14px] font-semibold">
          {description.title}
        </h2>
        <p id="git-action-dialog-summary" className="mt-2 text-dim">
          {description.summary}
        </p>
        {description.warnings.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {description.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2 text-[12.5px] text-[#d29922]">
                <IconAlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}
        {error !== null && (
          <div role="alert" className="mt-3">
            <p className="text-[12.5px] text-[#ff7b72]">git refused:</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-line bg-canvas p-2 font-mono text-[11.5px] whitespace-pre-wrap text-fg">
              {error}
            </pre>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className={`${buttonClass} border-line bg-canvas text-fg hover:bg-rowhover`}
            onClick={() => {
              if (!isRunning) onCancel()
            }}
            aria-disabled={isRunning ? 'true' : undefined}
            title={isRunning ? 'waiting for git to finish' : undefined}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`${buttonClass} border-accent bg-accent/15 text-fg hover:bg-accent/25`}
            onClick={() => {
              if (!isRunning) onConfirm()
            }}
            aria-disabled={isRunning ? 'true' : undefined}
            title={isRunning ? 'waiting for git to finish' : undefined}
          >
            {isRunning && <IconLoader2 size={14} className="animate-spin" aria-hidden />}
            {error !== null ? 'Try again' : description.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
