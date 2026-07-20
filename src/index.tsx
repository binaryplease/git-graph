import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { FileDiffPage } from './FileDiffPage'
import { CommitDiffPage } from './CommitDiffPage'
import { ComparePage } from './ComparePage'
import { COMMIT_DIFF_ROUTE, COMPARE_ROUTE, FILE_DIFF_ROUTE } from './lib/diffRoutes'

// One bundle, several entry points: the graph shell plus the standalone diff
// tabs a change opens in a new tab. The server's SPA fallback serves this same
// HTML for every path, so the pathname is all that distinguishes them.
function routeFor(pathname: string) {
  if (pathname === FILE_DIFF_ROUTE) return <FileDiffPage />
  if (pathname === COMMIT_DIFF_ROUTE) return <CommitDiffPage />
  if (pathname === COMPARE_ROUTE) return <ComparePage />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{routeFor(location.pathname)}</StrictMode>,
)
