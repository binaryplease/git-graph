import { useCallback, useState } from 'react'
import { z } from 'zod/v4'

// Where the commit-detail view renders in the standalone app: `inline` expands
// it in-flow beneath the selected commit row (the default — details read in
// place, the way mhutchie's Git Graph opens its Inline commit view); `sidebar`
// docks it as the right rail. A user preference, persisted like the color theme.
//
// App-only, like `useTheme`: it reads/writes localStorage and only the graph
// shell (App.tsx) chooses where CommitDetailPanel mounts. An embedding host
// (nightshift-ui) owns its own layout, so this never rides the host-facing
// components barrel (ADR-0032 — it lives with its localStorage dependency).

// Persisted-client-state schema (ADR-0013/0029): validated on read so a stale or
// garbage localStorage value falls back to the default rather than throwing.
export const DETAIL_LAYOUTS = ['inline', 'sidebar'] as const
export const DetailLayoutSchema = z.enum(DETAIL_LAYOUTS).default('inline').catch('inline')
export type DetailLayout = z.infer<typeof DetailLayoutSchema>

const DETAIL_LAYOUT_STORAGE_KEY = 'binp-git-graph:detail-layout'

function readStoredDetailLayout(): DetailLayout {
  return DetailLayoutSchema.parse(window.localStorage.getItem(DETAIL_LAYOUT_STORAGE_KEY) ?? undefined)
}

// Owns the persisted layout preference. No document side effects — unlike the
// theme this only decides which container the app renders the panel into.
export function useDetailLayout(): {
  detailLayout: DetailLayout
  setDetailLayout: (nextDetailLayout: DetailLayout) => void
} {
  const [detailLayout, setDetailLayoutState] = useState<DetailLayout>(readStoredDetailLayout)

  const setDetailLayout = useCallback((nextDetailLayout: DetailLayout) => {
    window.localStorage.setItem(DETAIL_LAYOUT_STORAGE_KEY, nextDetailLayout)
    setDetailLayoutState(nextDetailLayout)
  }, [])

  return { detailLayout, setDetailLayout }
}
