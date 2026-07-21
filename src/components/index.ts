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
