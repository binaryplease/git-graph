// The public components barrel (ADR-0026: one entry, one surface). The four
// fetch-free, prop-driven render components — commit graph, one file's diff, a
// whole change set, and the commit detail panel — exposed as a stable subpath
// (`git-graph/components`) so a host app (nightshift-ui) mounts the render
// layer over a Vite source-alias without reaching into internal file paths, and
// the standalone app imports the identical modules from here too (no second
// copy, no drift). Every one of these owns no data fetching and no app chrome:
// the host supplies the data as props and a `loadFileDiff` callback.
export { CommitGraph } from './CommitGraph'
export type { CommitGraphProps, CommitGraphStats } from './CommitGraph'

export { FileDiff } from './FileDiff'
export type { FileDiffProps } from './FileDiff'

export { MultiFileDiffView } from './MultiFileDiffView'
export type { MultiFileDiffViewProps } from './MultiFileDiffView'

export { CommitDetailPanel } from './CommitDetailPanel'
export type { CommitDetailPanelProps } from './CommitDetailPanel'

// The ref pill both of the above render. Exported because a host that lists
// refs anywhere else (a branch rail, a compare header) must render the same
// badge from the same grouped shape — `groupRefDecorations` in `git-graph/shared`
// produces its input (ADR-0026: one descriptor, one shared wrapper).
export { RefPill } from './RefPill'
export type { RefPillProps } from './RefPill'

// The row-level half of the checked-out signal the pill carries as state — the
// lane-coloured ring CommitGraph puts before a HEAD row's pills. Exported for
// the same reason as the graph geometry below: a host that renders its own row
// beside the graph marks HEAD with this ring, not with a second hand-rolled dot
// that drifts from it (ADR-0027/ADR-0028).
export { CheckedOutMarker } from './RefPill'
export type { CheckedOutMarkerProps } from './RefPill'

// The working-tree node that sits above HEAD in the graph. Rendered *outside*
// CommitGraph (the pinned layout algorithm never sees a non-commit), so a host
// composes it directly above the graph and aligns it with `graphContentLeft`.
export { UncommittedChangesRow } from './UncommittedChangesRow'
export type { UncommittedChangesRowProps } from './UncommittedChangesRow'

// The graph geometry a host needs to align that row — and any other non-commit
// row — with the commit subjects and the node column, rather than guessing a
// fixed inset that drifts as lanes are added.
export { GRAPH_NODE_COLUMN_X, ROW_HEIGHT, graphColumnWidth, graphContentLeft } from './CommitGraph'

// The host file-open seam (ADR-0026: one descriptor) shared by MultiFileDiffView
// and CommitDetailPanel — a host wires `onOpenFile` on either to open a changed
// file in its own surface without scraping the diff view's internal DOM.
export type { OpenFileHandler } from './fileStatus'
