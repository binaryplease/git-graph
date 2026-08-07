import { IconCircleCheck, IconPencil } from '@tabler/icons-react'
import type { WorkingTree } from '../../shared/git.schema'
import { GRAPH_NODE_COLUMN_X, ROW_HEIGHT } from './CommitGraph'
import { FileLineStats } from './fileStatus'

// The graph's "Uncommitted changes" node — a synthetic row above HEAD, the way
// mhutchie's Git Graph and GitKraken mark the working tree at the top of
// history. It is rendered outside CommitGraph so the pinned layout algorithm
// never sees a non-commit. The leading glyph states which it is at a glance: a
// pencil (matching the /working tab's own header) when there are edits to view,
// a check when the tree is clean — never an ambiguous dashed ring that reads as
// a spinner or as pending changes. ADR-0022: real icons, not hand-drawn markers.
// The text is inset by `graphContentLeft(laneCount)` — the exact padding the
// commit rows use — so it lines up with the commit subjects below, and the icon
// sits in the graph gutter aligned to the node column. ADR-0031: adjacent to the
// history it summarises. ADR-0025: when the tree is clean the control stays
// visible and explains that there is nothing to open, rather than vanishing.
//
// It lives in the components barrel rather than in `App.tsx` because it is read
// on **two** surfaces (ADR-0026 / ADR-0027 — the unit of sharing is the
// invariant): the standalone graph shell here, and nightshift-ui's
// `<GitGraphPanel>`, which mounts the same fetch-free render layer over a Vite
// source-alias. It stayed app-local through its first three commits and so was
// simply absent from the host — the whole feature was invisible in nightshift-ui
// while looking present in this repo.
const MARKER_SIZE = 16
const markerStyle = { left: GRAPH_NODE_COLUMN_X - MARKER_SIZE / 2 }

const ROW_CLASS = 'relative flex items-center gap-2 border-b border-line pr-4'

export type UncommittedChangesRowProps = {
  /** The repository's uncommitted changes, as the working-tree route reports them. */
  working: WorkingTree
  /**
   * Left inset for the text, matching the commit rows' `graphContentLeft` for
   * the graph's current lane count.
   */
  contentLeft: number
  /**
   * Where to open the change set. A host with a standalone diff tab passes its
   * URL (this repo's `/working` route) and the row renders a real link — so
   * cmd/middle-click and "open in new tab" work; a host with **no** diff-tab
   * routes passes null and wires {@link onOpen} instead. Same href-or-handler
   * seam `CommitDetailPanel` already offers its two open-diff controls.
   */
  href?: string | null
  /**
   * Open the change set in the host's own surface (nightshift-ui's in-app diff
   * modal). Takes precedence over {@link href} when both are given.
   */
  onOpen?: (() => void) | null
}

export function UncommittedChangesRow({
  working,
  contentLeft,
  href = null,
  onOpen = null,
}: UncommittedChangesRowProps) {
  const fileCount = working.files.length
  const additions = working.files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = working.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)

  // A clean tree has nothing to open. The row stays (ADR-0025) and says so,
  // rather than vanishing and leaving the reader unsure whether it was ever
  // checked.
  if (fileCount === 0) {
    return (
      <div
        className={`${ROW_CLASS} text-faint`}
        style={{ height: ROW_HEIGHT, paddingLeft: contentLeft }}
        title="working tree clean — no uncommitted changes to view"
      >
        <IconCircleCheck
          size={MARKER_SIZE}
          className="absolute top-1/2 -translate-y-1/2"
          style={markerStyle}
          aria-hidden
        />
        <span className="text-[12px]">Working tree clean</span>
      </div>
    )
  }

  const label = `view ${fileCount} uncommitted change${fileCount === 1 ? '' : 's'}`
  const body = (
    <>
      <IconPencil
        size={MARKER_SIZE}
        className="absolute top-1/2 -translate-y-1/2 text-accent"
        style={markerStyle}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-left text-[12px] text-accent">
        Uncommitted changes
        <span className="ml-2 text-faint">
          {fileCount} file{fileCount === 1 ? '' : 's'}
          {working.filesTruncated && '+'}
        </span>
      </span>
      <FileLineStats additions={additions} deletions={deletions} />
    </>
  )

  // A handler-driven host gets a real button, not a link with a dead href: the
  // row opens an in-app modal, which is not a navigation and must not offer
  // "open in new tab".
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`${ROW_CLASS} w-full cursor-pointer bg-transparent hover:bg-rowhover`}
        style={{ height: ROW_HEIGHT, paddingLeft: contentLeft }}
        title={`${label} in the diff view`}
      >
        {body}
      </button>
    )
  }

  return (
    <a
      href={href ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={`${ROW_CLASS} hover:bg-rowhover`}
      style={{ height: ROW_HEIGHT, paddingLeft: contentLeft }}
      title={`${label} in a new tab`}
    >
      {body}
    </a>
  )
}
