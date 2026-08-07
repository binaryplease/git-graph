// The public components barrel (ADR-0026: one entry, one surface). The four
// fetch-free, prop-driven render components — commit graph, one file's diff, a
// whole change set, and the commit detail panel — exposed as a stable subpath
// (`binp-git-graph/components`) so a host app (nightshift-ui) mounts the render
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
