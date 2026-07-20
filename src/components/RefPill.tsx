import type { ReactNode } from 'react'

// Git ref decorations render on two surfaces — graph rows and the commit
// detail panel — so the classification, the label, and the pill itself are one
// shared unit (ADR-0026/ADR-0027) rather than a copy on each side. The pill
// styling lives with the palette in `src/index.css`.

export type RefKind = 'head' | 'branch' | 'remote' | 'tag'

export function classifyRef(ref: string): RefKind {
  if (ref.startsWith('HEAD')) return 'head'
  if (ref.startsWith('tag:')) return 'tag'
  if (ref.startsWith('origin/') || ref.startsWith('remotes/')) return 'remote'
  return 'branch'
}

/** Display form of a ref: tags drop the `tag:` prefix git prints. */
export const refDisplayLabel = (ref: string) =>
  ref.startsWith('tag:') ? ref.replace(/^tag:\s*/, '') : ref

/**
 * The bare name a ref points at, with git's decoration syntax removed —
 * `HEAD -> main` is the branch `main`. This is what a user means when they copy
 * a branch name.
 */
export const refName = (ref: string) => refDisplayLabel(ref).replace(/^HEAD\s*->\s*/, '')

// The prop is `refDecoration`, not `ref`: React 19 treats `ref` as a real ref
// on function components and would never pass it through as data.
export function RefPill({
  refDecoration,
  children,
}: {
  refDecoration: string
  children?: ReactNode
}) {
  return (
    <span className={`ref-pill ref-${classifyRef(refDecoration)}`}>
      {refDisplayLabel(refDecoration)}
      {children}
    </span>
  )
}
