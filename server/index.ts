import { join, resolve } from 'node:path'
import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { z } from 'zod/v4'
import { config, isDev } from './config'
import { DiscoveryDocSchema, HealthResponseSchema } from './routes/discovery.schema'
import { gitRoutes } from './routes/git'

const SERVICE_NAME = 'binp-git-graph'
const SERVICE_VERSION = '0.1.0'

// Per ADR-0020, discovery URLs must be absolute. Honour the forwarded-* headers
// Caddy/Vite set so the URLs match the public origin; otherwise fall back to the
// request's own Host.
function publicOrigin(request: Request): string {
  const url = new URL(request.url)
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const forwardedHost = request.headers.get('x-forwarded-host')
  const proto = forwardedProto?.split(',')[0]?.trim() || url.protocol.replace(':', '')
  const host = forwardedHost?.split(',')[0]?.trim() || request.headers.get('host') || url.host
  return `${proto}://${host}`
}

const app = new Elysia()
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
            'returns their parsed commit history for graph rendering.\n\n' +
            'Discovery entrypoint: `GET /api` (ADR-0020).',
        },
        tags: [
          { name: 'system', description: 'Discovery, liveness, and metadata endpoints.' },
          { name: 'git', description: 'Repository listing and commit history.' },
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

// ADR-0018: a port conflict is a fatal startup error. Elysia's listen surfaces
// EADDRINUSE by default — do not swallow it.
app.listen({
  port: config.PORT,
  hostname: config.HOST,
  development: isDev,
})

console.log(`${SERVICE_NAME} serving ${config.GIT_GRAPH_ROOT} on http://${config.HOST}:${config.PORT}`)
