import { IconGitBranch, IconGitCommit, IconTag, type IconProps } from '@tabler/icons-react'
import type { ComponentType } from 'react'
import type { GraphView } from '../lib/graphView'

// App chrome, not a fetch-free render primitive: these drive the standalone
// app's persisted view preferences (`useGraphView`), so they stay out of the
// host-facing components barrel and are imported directly, like
// DetailLayoutToggle (ADR-0032). An embedding host owns its own chrome.

const GRAPH_VIEW_OPTIONS: Record<GraphView, { label: string; title: string; Icon: ComponentType<IconProps> }> = {
  branches: {
    label: 'Branches',
    title: 'One row per branch, remote and tag; click a row to list the commits on its line',
    Icon: IconGitBranch,
  },
  commits: { label: 'Commits', title: 'Every commit as a row', Icon: IconGitCommit },
}

// Branches first: it is the overview, Commits the detail.
const GRAPH_VIEW_ORDER: readonly GraphView[] = ['branches', 'commits']

const BUTTON_CLASS = 'flex cursor-pointer items-center gap-1 rounded-[5px] px-2 py-0.5 transition-colors'
const ACTIVE_CLASS = 'bg-accent/15 text-accent'
const IDLE_CLASS = 'text-dim hover:bg-rowhover hover:text-fg'

type GraphViewToggleProps = {
  graphView: GraphView
  onSelectGraphView: (nextGraphView: GraphView) => void
}

/** Segmented Branches | Commits switch for the graph. Both options stay visible; the active one is pressed. */
export function GraphViewToggle({ graphView, onSelectGraphView }: GraphViewToggleProps) {
  return (
    <div
      role="group"
      aria-label="Graph view"
      className="flex flex-none items-center gap-0.5 rounded-md border border-line p-0.5"
    >
      {GRAPH_VIEW_ORDER.map((option) => {
        const { label, title, Icon } = GRAPH_VIEW_OPTIONS[option]
        const isActive = graphView === option
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            title={title}
            onClick={() => onSelectGraphView(option)}
            className={`${BUTTON_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
          >
            <Icon className="size-3.5" stroke={2} aria-hidden="true" />
            {label}
          </button>
        )
      })}
    </div>
  )
}

type TagsAsRowsToggleProps = {
  tagsAsRows: boolean
  onToggle: (nextTagsAsRows: boolean) => void
  /** False in the Commits view, where every commit is a row already. */
  applies: boolean
}

/**
 * "Tags as rows" for the Branches view. In the Commits view it stays visible and
 * says why it does nothing there (ADR-0025); `aria-disabled` keeps it focusable
 * so the reason reaches the keyboard and assistive tech too.
 */
export function TagsAsRowsToggle({ tagsAsRows, onToggle, applies }: TagsAsRowsToggleProps) {
  const title = applies
    ? tagsAsRows
      ? 'On: every tagged commit gets a row of its own. Off: a tag shows on the row or commit it sits on, and only a tag nothing descends from gets a row.'
      : 'Off: a tag shows on the row or commit it sits on, and only a tag nothing descends from gets a row. On: every tagged commit gets a row of its own.'
    : 'Applies to the Branches view. The Commits view shows every commit as a row.'
  return (
    <div className="flex flex-none items-center rounded-md border border-line p-0.5">
      <button
        type="button"
        aria-pressed={tagsAsRows}
        aria-disabled={!applies}
        title={title}
        onClick={() => {
          if (applies) onToggle(!tagsAsRows)
        }}
        className={`${BUTTON_CLASS} ${
          !applies ? 'cursor-not-allowed text-faint opacity-60' : tagsAsRows ? ACTIVE_CLASS : IDLE_CLASS
        }`}
      >
        <IconTag className="size-3.5" stroke={2} aria-hidden="true" />
        Tags as rows
      </button>
    </div>
  )
}
