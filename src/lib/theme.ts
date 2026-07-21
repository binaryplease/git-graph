import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod/v4'

// The color-theme state for the standalone app (ADR-0026: one descriptor + one
// guard behind the ThemeToggle wrapper). Ported from the sibling
// binp-file-explorer, adapted for git-graph: this repo's git-diff-view body
// needs the *resolved* theme in JS to flip its palette, so the hook also returns
// `resolvedTheme` alongside the persisted mode.
//
// An embedding host (nightshift-ui) does not use this hook: it owns
// `<html data-theme>` itself and passes its own resolved scheme into the
// fetch-free components' `diffViewTheme` prop. So this module is app-only
// (localStorage + document writes) and lives with the standalone shells that
// depend on it (ADR-0032), never in the host-facing components barrel.

// Persisted-client-state schema (ADR-0013/0029): the mode the user picked,
// validated on read so a stale/garbage localStorage value falls back cleanly to
// the default rather than throwing. `system` follows the OS preference.
export const THEME_MODES = ['system', 'light', 'dark'] as const
export const ThemeModeSchema = z.enum(THEME_MODES).default('system').catch('system')
export type ThemeMode = z.infer<typeof ThemeModeSchema>

// A resolved theme is always concrete — `system` has been collapsed to whichever
// the OS currently prefers. This is what lands on <html data-theme> and drives
// the diff view's palette.
export type ResolvedTheme = 'dark' | 'light'

// Keep this key in sync with the pre-paint shim in index.html.
const THEME_STORAGE_KEY = 'binp-git-graph:theme'
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

function readStoredThemeMode(): ThemeMode {
  return ThemeModeSchema.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? undefined)
}

function systemResolvedTheme(): ResolvedTheme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light'
}

function resolveThemeMode(themeMode: ThemeMode): ResolvedTheme {
  return themeMode === 'system' ? systemResolvedTheme() : themeMode
}

function applyResolvedTheme(resolvedTheme: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolvedTheme
  // Aligns native affordances (scrollbars, form controls, caret) with the theme.
  document.documentElement.style.colorScheme = resolvedTheme
}

// Owns the persisted mode, the resolved theme derived from it, and the side
// effect of projecting the resolution onto <html>. Re-resolves live when the
// mode is `system` and the OS preference flips.
export function useTheme(): {
  themeMode: ThemeMode
  setThemeMode: (nextThemeMode: ThemeMode) => void
  resolvedTheme: ResolvedTheme
} {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStoredThemeMode)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveThemeMode(readStoredThemeMode()),
  )

  useEffect(() => {
    const resolved = resolveThemeMode(themeMode)
    setResolvedTheme(resolved)
    applyResolvedTheme(resolved)
    if (themeMode !== 'system') return

    const darkMediaQuery = window.matchMedia(DARK_MEDIA_QUERY)
    function handlePreferenceChange() {
      const systemTheme = systemResolvedTheme()
      setResolvedTheme(systemTheme)
      applyResolvedTheme(systemTheme)
    }
    darkMediaQuery.addEventListener('change', handlePreferenceChange)
    return () => darkMediaQuery.removeEventListener('change', handlePreferenceChange)
  }, [themeMode])

  const setThemeMode = useCallback((nextThemeMode: ThemeMode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextThemeMode)
    setThemeModeState(nextThemeMode)
  }, [])

  return { themeMode, setThemeMode, resolvedTheme }
}
