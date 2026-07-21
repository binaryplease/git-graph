import { IconLayoutList, IconLayoutSidebarRight, type IconProps } from '@tabler/icons-react'
import type { ComponentType } from 'react'
import { DETAIL_LAYOUTS, type DetailLayout } from '../lib/detailLayout'

// App chrome, not a fetch-free render primitive — it drives the standalone app's
// commit-detail layout preference, so it stays out of the host-facing components
// barrel and is imported directly, like ThemeToggle (ADR-0032: it lives with its
// useDetailLayout dependency; an embedding host owns its own layout).

const DETAIL_LAYOUT_OPTIONS: Record<DetailLayout, { label: string; Icon: ComponentType<IconProps> }> = {
  inline: { label: 'Show commit details inline, beneath the row', Icon: IconLayoutList },
  sidebar: { label: 'Show commit details in a sidebar', Icon: IconLayoutSidebarRight },
}

type DetailLayoutToggleProps = {
  detailLayout: DetailLayout
  onSelectDetailLayout: (nextDetailLayout: DetailLayout) => void
}

// Segmented control for where the commit-detail view renders. ADR-0031: this is
// a view-mode toggle for the detail surface, so it rides on that surface's own
// header (passed in as the panel's headerActions), not in the app-wide top bar.
// Both options stay visible; the active one is highlighted (ADR-0025). Icon-only
// buttons carry an aria-label so their meaning reaches assistive tech.
export function DetailLayoutToggle({ detailLayout, onSelectDetailLayout }: DetailLayoutToggleProps) {
  return (
    <div
      role="group"
      aria-label="Commit-detail layout"
      className="flex flex-none items-center gap-0.5 rounded-md border border-line p-0.5"
    >
      {DETAIL_LAYOUTS.map((optionDetailLayout) => {
        const { label, Icon } = DETAIL_LAYOUT_OPTIONS[optionDetailLayout]
        const isActive = detailLayout === optionDetailLayout
        return (
          <button
            key={optionDetailLayout}
            type="button"
            aria-label={label}
            aria-pressed={isActive}
            title={label}
            onClick={() => onSelectDetailLayout(optionDetailLayout)}
            className={`flex cursor-pointer items-center rounded-[5px] p-1 transition-colors ${
              isActive ? 'bg-accent/15 text-accent' : 'text-dim hover:bg-rowhover hover:text-fg'
            }`}
          >
            <Icon className="size-3.5" stroke={2} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
