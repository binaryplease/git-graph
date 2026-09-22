import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { z } from 'zod/v4'
import {
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_HEADER_VALUE,
} from '../../shared/mutationRequest'
import { checkMutationRequest } from './mutation-guard'

// The cross-origin gate is what stands between a foreign web page in the
// user's browser and a checkout on their disk. Each check is pinned on its own,
// because they are layered: a regression in one must fail here even while the
// others would still happen to refuse the request.

const clientHeaders = () =>
  new Headers({
    'content-type': 'application/json',
    [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_HEADER_VALUE,
  })

const noAllowlists = { additionalAllowedHosts: [], allowedOrigins: [] }
const proxiedAllowlists = { additionalAllowedHosts: ['graph.example.com'], allowedOrigins: [] }

const EMBEDDING_ORIGIN = 'http://127.0.0.1:3115'
const embeddingAllowlists = { additionalAllowedHosts: [], allowedOrigins: [EMBEDDING_ORIGIN] }

describe('checkMutationRequest', () => {
  test('admits the request the git-graph client sends', () => {
    expect(checkMutationRequest(clientHeaders(), noAllowlists)).toEqual({ ok: true })
  })

  test('admits a same-origin browser request, and a non-browser one that sends no Sec-Fetch-Site', () => {
    const sameOrigin = clientHeaders()
    sameOrigin.set('sec-fetch-site', 'same-origin')
    expect(checkMutationRequest(sameOrigin, noAllowlists).ok).toBe(true)
    expect(checkMutationRequest(clientHeaders(), noAllowlists).ok).toBe(true)
  })

  test('refuses a request the browser marks as cross-site or same-site, even with the header', () => {
    for (const fetchSite of ['cross-site', 'same-site', 'none']) {
      const headers = clientHeaders()
      headers.set('sec-fetch-site', fetchSite)
      const verdict = checkMutationRequest(headers, noAllowlists)
      expect(verdict.ok).toBe(false)
    }
  })

  test('admits an Origin naming a loopback host or an allowed host, on any port', () => {
    for (const origin of ['http://localhost:5183', 'http://127.0.0.1:3010', 'http://[::1]:3010']) {
      const headers = clientHeaders()
      headers.set('origin', origin)
      expect(checkMutationRequest(headers, noAllowlists).ok).toBe(true)
    }
    const proxied = clientHeaders()
    proxied.set('origin', 'https://graph.example.com')
    expect(checkMutationRequest(proxied, proxiedAllowlists).ok).toBe(true)
  })

  // NST11963 finding 3: with no Sec-Fetch-Site to go on, a foreign Origin was
  // admitted. The Origin is refused on its own now, whatever else is present.
  test('refuses a foreign Origin even when no Sec-Fetch-Site is sent', () => {
    for (const origin of ['http://evil.example', 'http://evil.localhost:3010', 'null', 'file://', 'not a url']) {
      const headers = clientHeaders()
      headers.set('origin', origin)
      const verdict = checkMutationRequest(headers, proxiedAllowlists)
      expect(verdict.ok).toBe(false)
    }
    const proxiedElsewhere = clientHeaders()
    proxiedElsewhere.set('origin', 'https://graph.example.com')
    expect(checkMutationRequest(proxiedElsewhere, noAllowlists).ok).toBe(false)
  })

  test('with no embedding origins configured, a cross-site request stays refused whatever its Origin', () => {
    const headers = clientHeaders()
    headers.set('origin', EMBEDDING_ORIGIN)
    headers.set('sec-fetch-site', 'same-site')
    expect(checkMutationRequest(headers, noAllowlists).ok).toBe(false)
  })

  test('admits a configured embedding host marked same-site or cross-site, and only by its exact Origin', () => {
    for (const fetchSite of ['same-site', 'cross-site']) {
      const headers = clientHeaders()
      headers.set('origin', EMBEDDING_ORIGIN)
      headers.set('sec-fetch-site', fetchSite)
      expect(checkMutationRequest(headers, embeddingAllowlists)).toEqual({ ok: true })
    }
    // A neighbour of the listed origin — another port, the other loopback name,
    // another scheme, a trailing slash — is not it.
    for (const origin of ['http://127.0.0.1:3116', 'http://localhost:3115', 'https://127.0.0.1:3115', `${EMBEDDING_ORIGIN}/`]) {
      const headers = clientHeaders()
      headers.set('origin', origin)
      headers.set('sec-fetch-site', 'same-site')
      expect(checkMutationRequest(headers, embeddingAllowlists).ok).toBe(false)
    }
    // A cross-site request with no Origin at all names no embedding host.
    const originless = clientHeaders()
    originless.set('sec-fetch-site', 'cross-site')
    expect(checkMutationRequest(originless, embeddingAllowlists).ok).toBe(false)
  })

  test('a listed non-loopback embedding origin is admitted without being a served Host', () => {
    const headers = clientHeaders()
    headers.set('origin', 'https://ui.example.com')
    headers.set('sec-fetch-site', 'cross-site')
    const allowlists = { additionalAllowedHosts: [], allowedOrigins: ['https://ui.example.com'] }
    expect(checkMutationRequest(headers, allowlists).ok).toBe(true)
    expect(checkMutationRequest(headers, noAllowlists).ok).toBe(false)
  })

  test('the embedding exception relaxes nothing else — the custom header and JSON body are still required', () => {
    const withoutHeader = clientHeaders()
    withoutHeader.delete(MUTATION_REQUEST_HEADER)
    withoutHeader.set('origin', EMBEDDING_ORIGIN)
    withoutHeader.set('sec-fetch-site', 'cross-site')
    expect(checkMutationRequest(withoutHeader, embeddingAllowlists).ok).toBe(false)
    const formBody = clientHeaders()
    formBody.set('content-type', 'text/plain')
    formBody.set('origin', EMBEDDING_ORIGIN)
    formBody.set('sec-fetch-site', 'cross-site')
    expect(checkMutationRequest(formBody, embeddingAllowlists).ok).toBe(false)
  })

  test('refuses a request without the custom header — what a plain form post looks like', () => {
    const headers = clientHeaders()
    headers.delete(MUTATION_REQUEST_HEADER)
    expect(checkMutationRequest(headers, noAllowlists).ok).toBe(false)
    headers.set(MUTATION_REQUEST_HEADER, 'yes')
    expect(checkMutationRequest(headers, noAllowlists).ok).toBe(false)
  })

  test('refuses a body that is not JSON — the content types a page may send without a preflight', () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
      const headers = clientHeaders()
      headers.set('content-type', contentType)
      expect(checkMutationRequest(headers, noAllowlists).ok).toBe(false)
    }
    const withCharset = clientHeaders()
    withCharset.set('content-type', 'application/json; charset=utf-8')
    expect(checkMutationRequest(withCharset, noAllowlists).ok).toBe(true)
  })
})

// Wired into Elysia the way `routes/git.ts` wires it, so the composition — not
// just the pure verdict — is pinned: a refused request never reaches the
// handler, and nothing grants the CORS preflight a cross-origin page would need.
describe('the guard on an Elysia route', () => {
  let handlerRuns = 0
  const app = new Elysia().post(
    '/api/git/mutate',
    () => {
      handlerRuns += 1
      return { ok: true }
    },
    {
      body: z.object({ repo: z.string() }),
      beforeHandle({ request, status }) {
        const verdict = checkMutationRequest(request.headers, noAllowlists)
        if (!verdict.ok) return status(403, { error: verdict.reason })
      },
    },
  )

  const post = (headers: Record<string, string>, body = '{"repo":""}') =>
    app.handle(new Request('http://127.0.0.1/api/git/mutate', { method: 'POST', headers, body }))

  // The test DOM (happy-dom, preloaded for the component tests) replaces the
  // global Request and drops browser-forbidden `Sec-*` headers from it, so the
  // `Sec-Fetch-Site` refusal is pinned on the pure verdict above; here the
  // missing custom header stands in for "not the git-graph client".
  test('a JSON request without the custom header is refused with 403 before the handler runs', async () => {
    handlerRuns = 0
    const response = await post({ 'content-type': 'application/json' })
    expect(response.status).toBe(403)
    expect(handlerRuns).toBe(0)
  })

  test('a form-shaped post never reaches the handler', async () => {
    handlerRuns = 0
    const response = await post({ 'content-type': 'text/plain' }, '{"repo":""}')
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(handlerRuns).toBe(0)
  })

  test('the client request reaches the handler', async () => {
    handlerRuns = 0
    const response = await post({
      'content-type': 'application/json',
      [MUTATION_REQUEST_HEADER]: MUTATION_REQUEST_HEADER_VALUE,
    })
    expect(response.status).toBe(200)
    expect(handlerRuns).toBe(1)
  })

  test('a CORS preflight is not granted', async () => {
    const response = await app.handle(
      new Request('http://127.0.0.1/api/git/mutate', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': MUTATION_REQUEST_HEADER,
        },
      }),
    )
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('access-control-allow-headers')).toBeNull()
  })
})
