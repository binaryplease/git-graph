import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCopy,
  IconExternalLink,
  IconGitBranch,
  IconGitCommit,
  IconGitCompare,
  IconTag,
} from '@tabler/icons-react'
import type { CheckoutTarget, GitCommit } from '../../shared/git.schema'
import {
  buildGitMenuSections,
  checkoutTargetForEntry,
  type GitActionId,
  type GitMenuEntry,
  type GitMenuInput,
} from '../../shared/gitActions'

// The git-action context menu (issue #2): what a right-click — or Shift+F10 /
// the context-menu key — opens on a commit row or a ref pill. Fetch-free and
// prop-driven like every component behind the barrel, so nightshift-ui opens the
// same menu (ADR-0026/ADR-0027). Which entries exist and why one cannot apply is
// `buildGitMenuSections` in `git-graph/shared`; this adds the icons, turns the
// host's handlers into actions, and owns the menu keyboard behaviour.
//
// A host that wires no handler for an action still gets the entry, disabled
// with a reason (ADR-0025) — never a silently shorter menu.

/** Viewport coordinates the menu opens at — the pointer, or the focused row for the keyboard. */
export type GitActionMenuAnchor = { x: number; y: number }

/** A one-line outcome the menu hands back for the host to show (e.g. a copy). */
export type GitActionNotice = { tone: 'success' | 'error'; text: string }

export type GitActionMenuProps = {
  /** The commit, its grouped refs, the pill it was opened on, where HEAD is, and the default branch. */
  input: GitMenuInput
  anchor: GitActionMenuAnchor
  /** Close the menu. Called on Escape, Tab, a pointer press outside, scroll, resize, and after an entry runs. */
  onClose: () => void
  /**
   * Run a checkout. The menu only *requests* it: the host states what it will do
   * and confirms before anything runs (every checkout entry is `mutates`).
   * Absent → every checkout entry is disabled with a reason.
   */
  onCheckout?: (target: CheckoutTarget) => void
  /** The `/commit` diff-tab URL for a commit. Absent or null → "Open commit" is disabled. */
  buildCommitHref?: (commit: GitCommit) => string | null
  /** The `/compare` URL for a branch against the default. Absent or null → "Compare" is disabled. */
  buildCompareHref?: (branchName: string) => string | null
  /** Receives the outcome of an entry the menu runs itself (copying a hash). */
  onNotice?: (notice: GitActionNotice) => void
}

const ICON_SIZE = 15

const ACTION_ICONS: Record<GitActionId, ReactNode> = {
  'checkout-commit': <IconGitCommit size={ICON_SIZE} aria-hidden />,
  'copy-commit-hash': <IconCopy size={ICON_SIZE} aria-hidden />,
  'copy-short-hash': <IconCopy size={ICON_SIZE} aria-hidden />,
  'open-commit': <IconExternalLink size={ICON_SIZE} aria-hidden />,
  'checkout-branch': <IconGitBranch size={ICON_SIZE} aria-hidden />,
  'compare-branch': <IconGitCompare size={ICON_SIZE} aria-hidden />,
  'checkout-tag': <IconTag size={ICON_SIZE} aria-hidden />,
}

// The Clipboard API needs a secure context — the same guard CopyButton uses.
const clipboardIsAvailable = () =>
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'

/** One entry, resolved against the host's handlers: either runnable, a link, or unavailable. */
type ResolvedEntry = {
  entry: GitMenuEntry
  /** Why the entry is disabled — the state's reason first, then a missing handler's. */
  disabledReason: string | null
  href: string | null
  run: (() => void) | null
}

const notOfferedHere = (entry: GitMenuEntry) => `${entry.label.toLowerCase()} is not offered in this view`

export function GitActionMenu({
  input,
  anchor,
  onClose,
  onCheckout,
  buildCommitHref,
  buildCompareHref,
  onNotice,
}: GitActionMenuProps) {
  const sections = buildGitMenuSections(input)
  const { commit } = input

  function copy(value: string, what: string) {
    navigator.clipboard.writeText(value).then(
      () => onNotice?.({ tone: 'success', text: `Copied ${what} ${value}` }),
      (error: unknown) =>
        onNotice?.({
          tone: 'error',
          text: `Could not copy ${what}: ${error instanceof Error ? error.message : 'copying failed'}`,
        }),
    )
  }

  function resolve(entry: GitMenuEntry): ResolvedEntry {
    const unavailable = (reason: string): ResolvedEntry => ({ entry, disabledReason: reason, href: null, run: null })
    if (entry.unavailableReason !== null) return unavailable(entry.unavailableReason)

    const checkoutTarget = checkoutTargetForEntry(entry, commit)
    if (checkoutTarget !== null) {
      if (!onCheckout) return unavailable(notOfferedHere(entry))
      return { entry, disabledReason: null, href: null, run: () => onCheckout(checkoutTarget) }
    }

    switch (entry.action) {
      case 'copy-commit-hash':
      case 'copy-short-hash': {
        if (!clipboardIsAvailable()) return unavailable('copying needs a secure context (https or localhost)')
        const isFull = entry.action === 'copy-commit-hash'
        const value = isFull ? commit.fullHash : commit.hash
        return { entry, disabledReason: null, href: null, run: () => copy(value, isFull ? 'commit hash' : 'short hash') }
      }
      case 'open-commit': {
        const href = buildCommitHref?.(commit) ?? null
        return href === null ? unavailable(notOfferedHere(entry)) : { entry, disabledReason: null, href, run: null }
      }
      case 'compare-branch': {
        const href = buildCompareHref?.(entry.subject) ?? null
        return href === null ? unavailable(notOfferedHere(entry)) : { entry, disabledReason: null, href, run: null }
      }
      default:
        return unavailable(notOfferedHere(entry))
    }
  }

  const resolvedSections = sections.map((section) => ({ ...section, entries: section.entries.map(resolve) }))
  const itemCount = resolvedSections.reduce((count, section) => count + section.entries.length, 0)

  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const [position, setPosition] = useState(anchor)
  const [activeIndex, setActiveIndex] = useState(0)
  // Where focus was when the menu opened (the row, for a keyboard open), so a
  // keyboard close hands it back instead of dropping it on <body>.
  const invokerRef = useRef<Element | null>(null)

  // Keep the menu inside the viewport: shifted left from a pointer near the
  // right edge, flipped above one near the bottom.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (menu === null) return
    const margin = 8
    const { width, height } = menu.getBoundingClientRect()
    const x = anchor.x + width + margin > window.innerWidth ? Math.max(margin, window.innerWidth - width - margin) : anchor.x
    const y = anchor.y + height + margin > window.innerHeight ? Math.max(margin, anchor.y - height) : anchor.y
    setPosition({ x, y })
  }, [anchor])

  useEffect(() => {
    invokerRef.current = document.activeElement
    itemRefs.current[0]?.focus()
  }, [])

  // Pointer presses outside, scrolling, resizing, and leaving the window all
  // close the menu — it is anchored to a spot that no longer means anything.
  useEffect(() => {
    const isInsideMenu = (target: EventTarget | null) => target instanceof Node && menuRef.current?.contains(target)
    const handlePointerDown = (event: PointerEvent) => {
      if (!isInsideMenu(event.target)) onClose()
    }
    const handleScroll = (event: Event) => {
      if (!isInsideMenu(event.target)) onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  function closeAndRestoreFocus() {
    onClose()
    if (invokerRef.current instanceof HTMLElement) invokerRef.current.focus()
  }

  function focusItem(index: number) {
    const wrapped = (index + itemCount) % itemCount
    setActiveIndex(wrapped)
    itemRefs.current[wrapped]?.focus()
  }

  function activate(resolved: ResolvedEntry) {
    if (resolved.disabledReason !== null) return
    closeAndRestoreFocus()
    resolved.run?.()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Handled keys stay inside the menu: the host's own shortcuts (↑/↓ walking
    // the graph, Esc closing the detail panel) must not also fire.
    switch (event.key) {
      case 'ArrowDown':
        focusItem(activeIndex + 1)
        break
      case 'ArrowUp':
        focusItem(activeIndex - 1)
        break
      case 'Home':
        focusItem(0)
        break
      case 'End':
        focusItem(itemCount - 1)
        break
      case 'Escape':
        closeAndRestoreFocus()
        break
      case 'Tab':
        onClose()
        return
      case 'Enter':
      case ' ':
        // One path for buttons and links: the element's own click, so a link
        // opens its tab and a button runs its action exactly as a pointer would.
        itemRefs.current[activeIndex]?.click()
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  let itemIndex = -1
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`git actions for ${input.focusedGroup ? input.focusedGroup.name : `commit ${commit.hash}`}`}
      className="fixed z-50 min-w-60 max-w-sm rounded-md border border-line bg-raised py-1 font-sans text-[12.5px] text-fg shadow-xl shadow-black/40"
      style={{ left: position.x, top: position.y }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {resolvedSections.map((section, sectionIndex) => (
        <div
          key={section.heading}
          role="group"
          aria-label={section.heading}
          className={sectionIndex > 0 ? 'mt-1 border-t border-line pt-1' : undefined}
        >
          <div className="truncate px-3 pt-0.5 pb-1 font-mono text-[11px] text-faint" aria-hidden>
            {section.heading}
          </div>
          {section.entries.map((resolved) => {
            itemIndex += 1
            const index = itemIndex
            const { entry, disabledReason, href } = resolved
            const isDisabled = disabledReason !== null
            const className = `flex w-full items-center gap-2 px-3 py-1 text-left focus:bg-rowhover focus:outline-none ${
              isDisabled ? 'cursor-not-allowed text-faint' : 'cursor-pointer hover:bg-rowhover'
            }`
            const content = (
              <>
                <span className={isDisabled ? 'opacity-60' : 'text-dim'}>{ACTION_ICONS[entry.action]}</span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              </>
            )
            const shared = {
              ref: (element: HTMLElement | null) => {
                itemRefs.current[index] = element
              },
              role: 'menuitem',
              tabIndex: index === activeIndex ? 0 : -1,
              className,
              // ADR-0025: an entry that cannot apply stays and says why.
              title: disabledReason ?? undefined,
              onMouseEnter: () => focusItem(index),
            } as const
            return href !== null ? (
              <a
                key={entry.action + entry.subject}
                {...shared}
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={() => closeAndRestoreFocus()}
              >
                {content}
              </a>
            ) : (
              <button
                key={entry.action + entry.subject}
                {...shared}
                type="button"
                aria-disabled={isDisabled ? 'true' : undefined}
                onClick={() => activate(resolved)}
              >
                {content}
              </button>
            )
          })}
        </div>
      ))}
    </div>,
    document.body,
  )
}
