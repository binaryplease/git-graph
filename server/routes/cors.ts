import { Elysia } from 'elysia'
import { corsHeadersFor } from '../services/cors'

// The orchestration half of the embedding seam; the decision is
// services/cors.ts. Mounted right after the Host guard in index.ts, so a request
// for a foreign Host is refused before it could be granted anything.
//
// Scoped to `/api/`: the embedding host reads the API, never the static client.
// For a listed Origin the headers are set in `onRequest`, before routing, so they
// ride on every response the request produces — a 404 for a repository outside
// the served set or git's 409 refusal included, which the host must be able to
// read to show. A preflight (`OPTIONS`) from a listed Origin is answered here
// with 204; there are no OPTIONS routes. For any other Origin nothing is set and
// an OPTIONS request falls through unanswered, as it always has.
export function corsPlugin(options: { allowedOrigins: string[] }) {
  const { allowedOrigins } = options
  return new Elysia({ name: 'cors' }).onRequest(({ request, set }) => {
    if (!new URL(request.url).pathname.startsWith('/api/')) return
    const corsHeaders = corsHeadersFor(request.headers.get('origin'), allowedOrigins)
    if (Object.keys(corsHeaders).length === 0) return
    Object.assign(set.headers, corsHeaders)
    if (request.method === 'OPTIONS') {
      set.status = 204
      return ''
    }
  })
}
