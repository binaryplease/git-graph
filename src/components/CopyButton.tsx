import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconCopy } from '@tabler/icons-react'

// The one copy-to-clipboard affordance (ADR-0026): a single descriptor for the
// label, one wrapper that owns the confirmation state, and one guard for the
// case where the Clipboard API is not there. Every surface that offers "copy
// this text" composes this rather than re-deriving it.

// The Clipboard API needs a secure context — served over plain http from
// something other than localhost, it is simply absent.
const clipboardIsAvailable = () =>
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'

const CONFIRMATION_MILLISECONDS = 1200

export type CopyButtonProps = {
  /** The text placed on the clipboard. */
  value: string
  /** What is being copied, for the tooltip and screen readers, e.g. `commit hash`. */
  label: string
}

export function CopyButton({ value, label }: CopyButtonProps) {
  const [hasCopied, setHasCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (confirmationTimer.current !== null) clearTimeout(confirmationTimer.current)
    },
    [],
  )

  const isAvailable = clipboardIsAvailable()

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopyError(null)
      setHasCopied(true)
      if (confirmationTimer.current !== null) clearTimeout(confirmationTimer.current)
      confirmationTimer.current = setTimeout(() => setHasCopied(false), CONFIRMATION_MILLISECONDS)
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : 'copying failed')
    }
  }

  // ADR-0025: when copying is impossible the control stays put and says why.
  const title = !isAvailable
    ? `copying ${label} needs a secure context (https or localhost)`
    : copyError !== null
      ? `could not copy ${label}: ${copyError}`
      : hasCopied
        ? `${label} copied`
        : `copy ${label}`

  return (
    <button
      type="button"
      className="inline-flex shrink-0 cursor-pointer items-center rounded p-0.5 text-faint transition-colors hover:bg-rowhover hover:text-fg disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-faint"
      onClick={handleCopy}
      disabled={!isAvailable}
      title={title}
      aria-label={title}
    >
      {hasCopied ? (
        <IconCheck size={14} className="text-[#7ee787]" aria-hidden />
      ) : (
        <IconCopy size={14} aria-hidden />
      )}
    </button>
  )
}
