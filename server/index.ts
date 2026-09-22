import { join, resolve } from 'node:path'
import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { z } from 'zod/v4'
import { additionalAllowedHosts, config, isDev } from './config'
import { createBindExposurePolicy } from './services/bind-exposure'
import { listenWithStrategy } from './services/listen'
import { resolvePublicOrigin } from './services/public-origin'
import { trustedHostPlugin } from './routes/trusted-host'
import {
  DiscoveryDocSchema,
  HealthResponseSchema,
  StatusResponseSchema,
} from './routes/discovery.schema'
import { gitRoutes } from './routes/git'

const SERVICE_NAME = 'git-graph'
const SERVICE_VERSION = '0.2.0'

// Captured once at module load, so `/api/status` can report how long this
// process has been serving. Reported as an ISO string and a derived uptime.
const processStartedAt = new Date()

// The port this process actually bound. In `auto` strategy the server may walk
// past a busy PORT, so the requested config.PORT is not necessarily the real
// one — status and the startup banner must report what was bound (ADR-0037).
// Set the moment `listenWithStrategy` returns, below.
let boundPort = config.PORT

// Per ADR-0020, discovery URLs must be absolute. The forwarded-* headers a proxy
// sets are honoured only where they name a host the server answers for; see
// services/public-origin.ts.
function publicOrigin(request: Request): string {
  return resolvePublicOrigin({
    requestUrl: request.url,
    hostHeader: request.headers.get('host'),
    forwardedProtocolHeader: request.headers.get('x-forwarded-proto'),
    forwardedHostHeader: request.headers.get('x-forwarded-host'),
    additionalAllowedHosts,
  })
}

// `nativeStaticResponse: false` is load-bearing for the Host guard below. By
// default Elysia hands a route whose handler is a fixed `Response` — the Scalar
// page at /api/docs is one — to Bun as a native static route, which answers
// without running any lifecycle hook, `onRequest` included. That route would
// then answer a rebound Host; with native statics off every route goes through
// the guard (pinned in index.test.ts).
const app = new Elysia({ nativeStaticResponse: false })
  // Issue #5: answer only for the names this server is reachable under, so a
  // DNS-rebound page gets nothing — not the docs, not a git read, not a
  // checkout. Mounted first; see routes/trusted-host.ts.
  .use(trustedHostPlugin({ additionalAllowedHosts }))
  // ADR-0020: human docs at /api/docs, machine spec at /api/openapi.json.
  .use(
    openapi({
      path: '/api/docs',
      specPath: '/api/openapi.json',
      // The plugin embeds `specPath` minus its leading `/`, which would resolve
      // to `/api/api/openapi.json` from `/api/docs`. Pin the absolute path.
      scalar: { url: '/api/openapi.json' },
      // Zod v4 ships its own JSON-Schema converter; wire it in explicitly.
      mapJsonSchema: { zod: z.toJSONSchema },
      documentation: {
        info: {
          title: 'Git Graph API',
          version: SERVICE_VERSION,
          description:
            'A local git commit-graph viewer. Lists the repositories at a served root and ' +
            'returns their parsed commit history for graph rendering, and checks out a ' +
            'branch, tag, or commit on request — the one route that changes a repository.\n\n' +
            'Discovery entrypoint: `GET /api` (ADR-0020).',
        },
        tags: [
          { name: 'system', description: 'Discovery, liveness, and metadata endpoints.' },
          { name: 'git', description: 'Repository listing, commit history, and checkout.' },
        ],
      },
    }),
  )
  // ADR-0020 §3: GET /api returns the discovery document. Always JSON, never a
  // redirect to /api/docs. URLs must be absolute.
  .get(
    '/api',
    ({ request }) => {
      const origin = publicOrigin(request)
      return {
        name: SERVICE_NAME,
        version: SERVICE_VERSION,
        docs: `${origin}/api/docs`,
        openapi: `${origin}/api/openapi.json`,
        health: `${origin}/api/health`,
      }
    },
    {
      response: { 200: DiscoveryDocSchema },
      detail: {
        tags: ['system'],
        summary: 'API discovery',
        description:
          'Canonical discovery entrypoint per ADR-0020. Returns a JSON document naming the docs, OpenAPI spec, and liveness probe. No auth required.',
      },
    },
  )
  .get('/api/health', () => ({ ok: true }) as const, {
    response: { 200: HealthResponseSchema },
    detail: {
      tags: ['system'],
      summary: 'Liveness probe',
      description: 'Returns `{ ok: true }` when the server is up. No auth required.',
    },
  })
  // ADR-0015: operational snapshot the CLI's `status` view renders. Distinct
  // from /api/health (liveness only) — this reports the served root, uptime,
  // the actually-bound port (ADR-0037), and process identity so a background
  // daemon is fully inspectable.
  .get(
    '/api/status',
    () => {
      const now = new Date()
      return {
        name: SERVICE_NAME,
        version: SERVICE_VERSION,
        pid: process.pid,
        uptimeSeconds: Math.max(0, Math.round((now.getTime() - processStartedAt.getTime()) / 1000)),
        startedAt: processStartedAt.toISOString(),
        host: config.HOST,
        port: boundPort,
        root: config.GIT_GRAPH_ROOT,
      }
    },
    {
      response: { 200: StatusResponseSchema },
      detail: {
        tags: ['system'],
        summary: 'Operational status',
        description:
          'Served root, uptime, bound port, and process identity of the running server. ' +
          'Rendered by `git-graph status`. No auth required.',
      },
    },
  )
  .use(gitRoutes)

// In production the built client is served from dist/client (this file runs as
// dist/server/index.js, so the client sits one directory over). In dev, Vite
// serves it on :5183 and proxies /api here.
if (!isDev) {
  const clientDirectory = resolve(import.meta.dir, '../client')
  app.get('/*', async ({ request }) => {
    const requestedPathname = decodeURIComponent(new URL(request.url).pathname)
    const candidatePath = resolve(clientDirectory, `.${requestedPathname}`)
    const isInsideClientDirectory =
      candidatePath === clientDirectory || candidatePath.startsWith(`${clientDirectory}/`)
    if (isInsideClientDirectory) {
      const assetFile = Bun.file(candidatePath)
      if (await assetFile.exists()) return assetFile
    }
    // SPA fallback: any non-asset path renders the graph shell.
    return Bun.file(join(clientDirectory, 'index.html'))
  })
}

// ADR-0037 §4: binding a non-loopback address publishes an unauthenticated git
// API, so it is a fatal startup error unless the operator named the served hosts
// in GIT_GRAPH_ALLOWED_HOSTS. Decided once, here, before we ever bind — never
// per request.
createBindExposurePolicy().enforce({
  bindHost: config.HOST,
  additionalAllowedHosts,
})

// Bind the listen port (ADR-0037 §3). `auto` (the default, every launch shape)
// walks upward from PORT to a free port, announcing each skip, so a stale dev
// session or a fleet of instances never collides; `strict` (an explicit
// operator pin) binds PORT exactly and dies loudly on a conflict (ADR-0018). The
// bind stays exclusive either way (no SO_REUSEPORT). See services/listen.ts.
boundPort = listenWithStrategy(app, {
  host: config.HOST,
  requestedPort: config.PORT,
  strategy: config.GIT_GRAPH_PORT_STRATEGY,
  isDev,
  announce: (skippedPort) =>
    console.log(`port ${skippedPort} is in use — trying ${skippedPort + 1}`),
})

// Hand the actually-bound port back to whoever launched us (the CLI) the moment
// we are listening, so an auto-assigned port needs no stdout parsing.
if (config.GIT_GRAPH_READY_FILE) {
  await Bun.write(config.GIT_GRAPH_READY_FILE, String(boundPort))
}

const localBase = `http://${config.HOST}:${boundPort}`
console.log(`${SERVICE_NAME} serving ${config.GIT_GRAPH_ROOT} on ${localBase}`)
console.log('Discovery')
console.log(`  docs:      ${localBase}/api/docs`)
console.log(`  openapi:   ${localBase}/api/openapi.json`)
console.log(`  discovery: ${localBase}/api`)
