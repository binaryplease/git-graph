import { Fragment, type MouseEvent, type ReactNode } from 'react'
import { refGroupLabel, refGroupTitle, type RefGroup } from '../../shared/refGroup'

// Git ref decorations render on two surfaces — graph rows and the commit
// detail panel — so they are shared units here (ADR-0026/ADR-0027) rather than
// a copy on each side. They take a {@link RefGroup}, not a raw decoration: what
// a pill shows is one *ref identity*, which is a local branch together with the
// remotes that agree with it, and that grouping is pure logic shared with the
// host through `git-graph/shared` (see `shared/refGroup.ts`). The styling lives
// with the palette in `src/theme.css`.
//
// This module exports at two granularities, and the split is the ADR-0027 rule
// rather than taste:
//
//   - {@link RefPill} is one ref, whole. Where a pill sits differs per surface
//     (the panel interleaves copy and compare controls between pills; a host
//     might list refs in a branch rail), so placement is *variation* and the
//     pill is the whole invariant.
//   - {@link CommitRefRow} is a commit row's refs, whole — the checked-out ring
//     then the pills, centred on one line with one gap. That arrangement is
//     *invariant*: the ring is meaningless where it is not immediately before
//     the refs it qualifies, so its placement must be shared with it. It is
//     therefore the exported unit, and {@link CheckedOutMarker} stays internal —
//     handing a host the bare ring to re-place is exactly the under-sharing
//     ADR-0027 names, and the failure this repo already paid for once with the
//     working-tree row.

export type RefPillProps = {
  /** One grouped ref — build these with `groupRefDecorations(commit.refs, remotes)`. */
  group: RefGroup
  children?: ReactNode
  /**
   * Opens the host's context menu for this ref. When set, a right-click on the
   * pill opens it instead of the browser's menu, and does not bubble on to the
   * row the pill sits in — the pill's menu leads with the pill's own ref.
   */
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void
}

/**
 * One ref pill. A branch that agrees with remotes is a single *segmented* chip:
 * the branch name, then each remote as a further segment divided off by a
 * hairline and set subordinate to it — containment says "these are the same
 * ref", so no glyph sits between them. The glyph that used to is git's own mark
 * for the opposite state: `%(upstream:trackshort)` prints `=` when a branch and
 * its upstream agree and reserves the two-direction form for *divergence*.
 *
 * A checked-out branch says so through pill state — the head colour it already
 * had, plus weight and a ring — instead of printing git's `HEAD -> ` plumbing
 * text, which none of Git Graph, GitLens/GitKraken or VS Code's Source Control
 * Graph puts on screen either. The row-level half of that signal is the ring
 * {@link CommitRefRow} places before the pills.
 *
 * A ref that exists on exactly one remote and nowhere locally is not in
 * agreement with anything — it is simply that remote's branch, so it keeps the
 * qualified name git printed (`origin/feature`) and gains no segments.
 */
export function RefPill({ group, children, onContextMenu }: RefPillProps) {
  const { text, markerRemotes } = refGroupLabel(group)
  // A checked-out branch reads as HEAD, the way it did before its remotes were
  // folded in — the marker is additive, it never replaces the kind.
  const kindClass = group.isHead ? 'head' : group.kind
  // Only a local branch is ever *checked out*: a detached HEAD is on no branch
  // at all and names itself `HEAD` in the pill already.
  const isCheckedOut = group.kind === 'branch' && group.isHead
  const isSegmented = markerRemotes.length > 0
  const className = ['ref-pill', `ref-${kindClass}`]
  if (isSegmented) className.push('ref-segmented')
  if (isCheckedOut) className.push('ref-checked-out')

  // A segmented pill moves its padding onto the segments, so host-supplied
  // trailing content becomes a segment of its own rather than sitting flush
  // against the chip's edge.
  const trailing = isSegmented && children ? <span className="ref-segment">{children}</span> : children

  return (
    <span
      className={className.join(' ')}
      title={refGroupTitle(group)}
      onContextMenu={
        onContextMenu &&
        ((event) => {
          event.preventDefault()
          event.stopPropagation()
          onContextMenu(event)
        })
      }
    >
      {isSegmented ? <span className="ref-segment">{text}</span> : text}
      {markerRemotes.map((remoteName) => (
        <Fragment key={remoteName}>
          {/* The space is deliberate: a whitespace-only flex item does not
              render, so the hairline divider stays tight while the pill's text
              still reads as `main origin` when it is copied or spoken. */}
          {' '}
          <span className="ref-segment ref-segment-remote">{remoteName}</span>
        </Fragment>
      ))}
      {trailing}
    </span>
  )
}

type CheckedOutMarkerProps = {
  /** The branch checked out at this commit — named in the marker's description. */
  branchName: string
  /** The row's lane colour, so the ring belongs to the branch line beside it. */
  color: string
}

/**
 * The checked-out mark for a commit row: a small lane-coloured ring sitting in
 * the row before its ref pills, the way Git Graph's own `commitHeadDot` marks
 * HEAD in the message column. It marks the row even when the head pill has
 * scrolled out of view horizontally, which pill state alone cannot do.
 *
 * Deliberately *not* drawn on the SVG commit node: `CommitGraph` already rings
 * the **selected** commit there, and a second ring would make "selected" and
 * "checked out" the same shape.
 *
 * Module-internal on purpose — a ring adrift from the refs it qualifies says
 * nothing, so {@link CommitRefRow} is what surfaces render and what the barrel
 * exports (ADR-0027 Rule 1: the shared unit is as large as the invariant, and
 * placement is part of it).
 */
function CheckedOutMarker({ branchName, color }: CheckedOutMarkerProps) {
  const description = `The branch "${branchName}" is currently checked out at this commit.`
  return (
    <span
      className="ref-head-dot"
      style={{ borderColor: color }}
      role="img"
      aria-label={description}
      title={description}
    />
  )
}

export type CommitRefRowProps = {
  /**
   * One commit's refs, already grouped by identity — build them with
   * `groupRefDecorations(commit.refs, remotes)` from `git-graph/shared`. Empty
   * renders nothing at all, not an empty box that still eats the row's gap.
   */
  groups: RefGroup[]
  /**
   * The row's lane colour (`var(--lane-N)`), which the checked-out ring adopts
   * so it reads as belonging to the branch line drawn beside it.
   */
  laneColor: string
  /** Opens the host's context menu for one of the pills; see {@link RefPillProps.onContextMenu}. */
  onRefContextMenu?: (group: RefGroup, event: MouseEvent<HTMLElement>) => void
}

/**
 * A commit row's ref decorations, whole: the checked-out ring, then one pill per
 * ref identity, on one centred line with one gap.
 *
 * This is the unit rather than the pill or the ring alone because the
 * *arrangement* is the invariant (ADR-0027 Rule 1). The ring carries no name of
 * its own on screen — it means "the branch in the pill right there is checked
 * out", so a surface that placed it anywhere else, or spaced it away from the
 * pills, would be showing a different thing while looking like the same one.
 * Which branch the ring names is derived here too, for the same reason: it is
 * the one local branch at this commit that HEAD points at, and a host
 * recomputing that rule is a chance to get it wrong. A detached HEAD is on no
 * branch, so it leaves the row unringed and speaks through its own `HEAD` pill.
 *
 * Both surfaces that draw a commit row use it — this repo's `CommitGraph` and
 * nightshift-ui's panel — and a host aligning its own non-commit row beside the
 * graph gets the same cluster instead of a hand-rolled dot that drifts from it.
 */
export function CommitRefRow({ groups, laneColor, onRefContextMenu }: CommitRefRowProps) {
  if (groups.length === 0) return null
  const checkedOutBranch =
    groups.find((group) => group.kind === 'branch' && group.isHead)?.name ?? null

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {/* The ring leads the row's refs, in the row and not on the SVG node —
          that ring marks the *selected* commit, and two rings of one shape
          would blur the two. */}
      {checkedOutBranch !== null && (
        <CheckedOutMarker branchName={checkedOutBranch} color={laneColor} />
      )}
      {groups.map((group) => (
        <RefPill
          key={`${group.kind}:${group.name}`}
          group={group}
          onContextMenu={onRefContextMenu && ((event) => onRefContextMenu(group, event))}
        />
      ))}
    </span>
  )
}
