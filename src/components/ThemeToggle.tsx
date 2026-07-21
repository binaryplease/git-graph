import { IconDeviceDesktop, IconMoon, IconSun, type IconProps } from '@tabler/icons-react'
import type { ComponentType } from 'react'
import { THEME_MODES, type ThemeMode } from '../lib/theme'

// App chrome, not a fetch-free render primitive — it drives the standalone app's
// theme, so it stays out of the host-facing components barrel and is imported
// directly, like CopyButton (ADR-0032: it lives with its useTheme dependency).

const THEME_MODE_OPTIONS: Record<ThemeMode, { label: string; Icon: ComponentType<IconProps> }> = {
  system: { label: 'Match system theme', Icon: IconDeviceDesktop },
  light: { label: 'Light theme', Icon: IconSun },
  dark: { label: 'Dark theme', Icon: IconMoon },
}

type ThemeToggleProps = {
  themeMode: ThemeMode
  onSelectThemeMode: (nextThemeMode: ThemeMode) => void
}

// Segmented control for the color theme. Theme is a truly app-global affordance,
// so it earns global chrome (ADR-0031) — it rides in each shell's header bar.
// All three options stay visible; the active one is highlighted (ADR-0025).
// Icon-only buttons carry an aria-label so their meaning reaches assistive tech.
export function ThemeToggle({ themeMode, onSelectThemeMode }: ThemeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Color theme"
      className="flex flex-none items-center gap-0.5 rounded-md border border-line p-0.5"
    >
      {THEME_MODES.map((optionThemeMode) => {
        const { label, Icon } = THEME_MODE_OPTIONS[optionThemeMode]
        const isActive = themeMode === optionThemeMode
        return (
          <button
            key={optionThemeMode}
            type="button"
            aria-label={label}
            aria-pressed={isActive}
            title={label}
            onClick={() => onSelectThemeMode(optionThemeMode)}
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
