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

// A commit row's refs, whole: the checked-out ring followed by one pill per ref
// identity, arranged on one line. This — not the ring alone — is what a host
// renders beside its own row. The arrangement is the invariant (the ring means
// "the branch in the pill *right there* is checked out"), so ADR-0027 Rule 1
// makes the cluster the shared unit and keeps the bare ring internal; handing a
// host a loose marker to re-place is the under-sharing the ADR names, and the
// failure this repo already paid for once with the working-tree row.
export { CommitRefRow } from './RefPill'
export type { CommitRefRowProps } from './RefPill'

// One ref on its own, for a surface that is not a commit row — the detail
// panel's refs line interleaves copy and compare controls between pills, and a
// host may list refs in a branch rail. Placement genuinely varies there, so the
// pill is the whole invariant and the surface composes it (ADR-0027 Rule 2).
// `groupRefDecorations` in `git-graph/shared` produces its input.
export { RefPill } from './RefPill'
export type { RefPillProps } from './RefPill'

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
