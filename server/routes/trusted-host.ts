import { Elysia } from 'elysia'
import { createTrustedHostGuard } from '../services/trusted-host'

// The orchestration half of the DNS-rebinding guard (issue #5); the decision is
// services/trusted-host.ts. A named plugin so index.ts mounts it in one line,
// ahead of everything else; server/index.test.ts pins it on the running server.
//
// `onRequest` runs before routing, so the refusal covers every route the app
// mounts after it — discovery, the OpenAPI docs, every git read, the checkout
// write, and the static client — and a rebound origin gets not one byte of
// repository data. Mount it first.
export function trustedHostPlugin(options: { additionalAllowedHosts: string[] }) {
  const guard = createTrustedHostGuard(options)
  return new Elysia({ name: 'trusted-host' }).onRequest(({ request, set }) => {
    const verdict = guard.evaluate(request.headers.get('host'))
    if (verdict.ok) return
    set.status = verdict.statusCode
    return { error: verdict.reason }
  })
}
