import type { ReactNode } from 'react'
import { IconArrowsUpDown } from '@tabler/icons-react'
import { refGroupLabel, refGroupTitle, type RefGroup } from '../../shared/refGroup'

// Git ref decorations render on two surfaces — graph rows and the commit
// detail panel — so the pill is one shared unit (ADR-0026/ADR-0027) rather than
// a copy on each side. It takes a {@link RefGroup}, not a raw decoration: what
// a pill shows is one *ref identity*, which is a local branch together with the
// remotes that agree with it, and that grouping is pure logic shared with the
// host through `git-graph/shared` (see `shared/refGroup.ts`). The pill styling
// lives with the palette in `src/theme.css`.

export type RefPillProps = {
  /** One grouped ref — build these with `groupRefDecorations(commit.refs, remotes)`. */
  group: RefGroup
  children?: ReactNode
}

/**
 * One ref pill. A checked-out branch keeps git's own `HEAD ->` marker and the
 * head colour; a branch that agrees with remotes gets a synced marker naming
 * them (`main ⇅ origin`), drawn as a Tabler vector rather than an arrow
 * character (ADR-0022).
 */
export function RefPill({ group, children }: RefPillProps) {
  const { text, markerRemotes } = refGroupLabel(group)
  // A checked-out branch reads as HEAD, the way it did before its remotes were
  // folded in — the marker is additive, it never replaces the kind.
  const kindClass = group.isHead ? 'head' : group.kind
  return (
    <span className={`ref-pill ref-${kindClass}`} title={refGroupTitle(group)}>
      {/* The spaces are deliberate: flex gaps space the parts visually, but the
          pill's text has to read as `HEAD -> main origin` when it is copied or
          spoken, not run together. Whitespace-only flex items do not render. */}
      {group.kind === 'branch' && group.isHead && (
        <span className="ref-head-marker">{'HEAD -> '}</span>
      )}
      {text}
      {markerRemotes.length > 0 && (
        <>
          {' '}
          <span className="ref-synced">
            <IconArrowsUpDown size={11} stroke={2.25} aria-hidden />
            {markerRemotes.join(', ')}
          </span>
        </>
      )}
      {children}
    </span>
  )
}
