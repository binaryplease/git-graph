import { useCallback, useState } from 'react'
import { z } from 'zod/v4'

// Which view the graph shell shows — `commits` (CommitGraph, every commit as a
// row; the default) or `branches` (BranchGraph, one row per ref, a line's
// commits on click) — and whether the Branches view gives a tag-only commit a
// row of its own. User preferences, persisted like the detail layout.
//
// App-only, like `useDetailLayout`: it reads and writes localStorage, and only
// the graph shell (App.tsx) chooses which view mounts. An embedding host owns
// its own chrome, so this never rides the host-facing components barrel
// (ADR-0032 — it lives with its localStorage dependency).

export const GRAPH_VIEWS = ['commits', 'branches'] as const
export type GraphView = (typeof GRAPH_VIEWS)[number]

// Persisted-client-state schema (ADR-0013/0029): every field has a default and
// falls back to it on a bad value, so an absent, older, or garbage stored value
// parses to a working preference instead of throwing.
const DEFAULT_GRAPH_VIEW_SETTINGS = { view: 'commits', tagsAsRows: false } as const
export const GraphViewSettingsSchema = z
  .object({
    view: z.enum(GRAPH_VIEWS).default('commits').catch('commits'),
    tagsAsRows: z.boolean().default(false).catch(false),
  })
  .default(DEFAULT_GRAPH_VIEW_SETTINGS)
  .catch(DEFAULT_GRAPH_VIEW_SETTINGS)
export type GraphViewSettings = z.infer<typeof GraphViewSettingsSchema>

export const GRAPH_VIEW_STORAGE_KEY = 'git-graph:graph-view'

/** Parse a stored value; anything that is not valid JSON of the right shape yields the defaults. */
export function parseStoredGraphViewSettings(stored: string | null): GraphViewSettings {
  if (stored === null) return GraphViewSettingsSchema.parse(undefined)
  try {
    return GraphViewSettingsSchema.parse(JSON.parse(stored))
  } catch {
    return GraphViewSettingsSchema.parse(undefined)
  }
}

/** Owns the persisted view preferences. */
export function useGraphView(): {
  graphView: GraphView
  setGraphView: (nextGraphView: GraphView) => void
  tagsAsRows: boolean
  setTagsAsRows: (nextTagsAsRows: boolean) => void
} {
  const [settings, setSettings] = useState<GraphViewSettings>(() =>
    parseStoredGraphViewSettings(window.localStorage.getItem(GRAPH_VIEW_STORAGE_KEY)),
  )

  const update = useCallback((change: Partial<GraphViewSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...change }
      window.localStorage.setItem(GRAPH_VIEW_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const setGraphView = useCallback((nextGraphView: GraphView) => update({ view: nextGraphView }), [update])
  const setTagsAsRows = useCallback((nextTagsAsRows: boolean) => update({ tagsAsRows: nextTagsAsRows }), [update])

  return { graphView: settings.view, setGraphView, tagsAsRows: settings.tagsAsRows, setTagsAsRows }
}
