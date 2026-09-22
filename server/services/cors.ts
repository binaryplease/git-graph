import { MUTATION_REQUEST_HEADER } from '../../shared/mutationRequest'

// Cross-origin (CORS) access for an embedding host — the one deliberate seam
// through the same-origin policy. Its own module (ADR-0032): headers and the
// operator's list in, headers out; it would work unchanged if the git routes
// were deleted.
//
// git-graph ships no CORS by default: a page from another origin can neither
// read a response nor get the preflight a checkout needs. An embedding host
// (nightshift-ui) runs this server as a separate loopback process and mounts
// git-graph's render layer in its own page, which is a different origin, so it
// needs both. Opening the seam is an explicit opt-in naming *exact* origins
// (`GIT_GRAPH_ALLOWED_ORIGINS`, scheme + host + port): only a listed Origin gets
// CORS headers reflected back — and only a listed Origin gets past the mutation
// guard's cross-site refusal (services/mutation-guard.ts). An unlisted Origin
// gets no headers, so the browser blocks the read and refuses the preflight,
// exactly as without the seam. It never touches the loopback bind or the Host
// guard: a request for a foreign Host is refused before this runs.
//
// Precedent: binp-file-explorer's `EXPLORER_ALLOWED_ORIGINS`, whose host side is
// nightshift-ui's `server/fileExplorer.ts`.

// What the git routes actually use: GET for the reads, POST with a JSON body and
// the mutation header for a checkout. No credentials — the server has none.
const ALLOWED_METHODS = 'GET, POST'
const ALLOWED_HEADERS = `content-type, ${MUTATION_REQUEST_HEADER.toLowerCase()}`
const PREFLIGHT_MAX_AGE_SECONDS = '600'

/**
 * Parse the operator's comma-separated origin list. Each entry must already be
 * a serialised origin — `http(s)://host[:port]`, no path, no trailing slash, as a
 * browser writes it in the `Origin` header — because matching is exact string
 * equality and an entry the browser can never send would silently admit nothing.
 * Throws on the first bad entry, naming it, so a typo fails the boot.
 */
export function parseAllowedOrigins(rawList: string): string[] {
  const entries = rawList
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  for (const entry of entries) {
    const parsed = URL.canParse(entry) ? new URL(entry) : null
    const isHttp = parsed !== null && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    if (!isHttp || parsed.origin !== entry) {
      throw new Error(
        `GIT_GRAPH_ALLOWED_ORIGINS entry ${JSON.stringify(entry)} is not an origin; ` +
          'write it the way a browser sends it, e.g. http://127.0.0.1:3115 (scheme, host, port; no path or trailing slash)',
      )
    }
  }
  return [...new Set(entries)]
}

/** Whether `origin` is one the operator listed — exact match, nothing inferred. */
export function isAllowedOrigin(origin: string | null, allowedOrigins: string[]): boolean {
  return origin !== null && allowedOrigins.includes(origin)
}

/**
 * The CORS response headers for a request from `origin`, or `{}` when it is
 * absent or unlisted (no headers → the browser blocks the read and the
 * preflight). `Vary: Origin` keeps a cache from handing one Origin's grant to
 * another.
 */
export function corsHeadersFor(origin: string | null, allowedOrigins: string[]): Record<string, string> {
  if (origin === null || !isAllowedOrigin(origin, allowedOrigins)) return {}
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
    'access-control-allow-methods': ALLOWED_METHODS,
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-max-age': PREFLIGHT_MAX_AGE_SECONDS,
  }
}
