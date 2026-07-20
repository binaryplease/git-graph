import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { FileDiffPage } from './FileDiffPage'
import { FILE_DIFF_ROUTE } from './lib/fileDiffLink'

// Two entry points, one bundle: the graph shell, and the standalone diff tab a
// changed file opens in a new tab. The server's SPA fallback serves this same
// HTML for /diff, so the pathname is all that distinguishes them.
const isFileDiffRoute = location.pathname === FILE_DIFF_ROUTE

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isFileDiffRoute ? <FileDiffPage /> : <App />}</StrictMode>,
)
