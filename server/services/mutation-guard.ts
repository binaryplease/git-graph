import {
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_HEADER_VALUE,
} from '../../shared/mutationRequest'
import { isTrustedOrigin } from './trusted-host'

// The cross-origin gate in front of every mutating route. Its own module
// (ADR-0032): it depends on nothing but request headers, and it would work
// unchanged if the git service it protects were deleted. The membership guards
// decide *what* a write may touch; this decides *who* may ask for one.
//
// Four independent checks, each sufficient against a foreign page on its own
// in the browsers that honour it — they are layered, not alternatives:
//
//   1. The custom header (`shared/mutationRequest.ts`). A cross-origin page
//      cannot set it without a CORS preflight, and this service answers none.
//   2. A JSON content type. Same reason: `application/json` is not a "simple"
//      content type, so a form post or a `no-cors` fetch cannot carry it.
//   3. `Sec-Fetch-Site`, when the browser sends it, must say `same-origin`. A
//      browser that knows the request came from another site says so, and that
//      is refused outright rather than left to the preflight.
//   4. `Origin`, when sent, must name a host the server answers for — the same
//      allowlist as the `Host` guard (services/trusted-host.ts). This covers a
//      browser that sends no `Sec-Fetch-Site` but does say where the request
//      came from; an opaque `null` origin names no host and is refused.
//
// DNS rebinding, where the attacker's page *is* same-origin with the service as
// far as the browser can tell, is not this gate's job: the rebound request
// carries the attacker's name in `Host`, and the trusted-host guard refuses it
// before routing, so it never reaches a mutating route at all.

export type MutationRequestVerdict = { ok: true } | { ok: false; reason: string }

/**
 * Decide whether a request may reach a mutating route. Pure: headers and the
 * operator's allowlist (`GIT_GRAPH_ALLOWED_HOSTS`) in, verdict out.
 */
export function checkMutationRequest(headers: Headers, additionalAllowedHosts: string[]): MutationRequestVerdict {
  const fetchSite = headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') {
    return {
      ok: false,
      reason: `refused a ${fetchSite} request: git actions only run for the git-graph page itself`,
    }
  }

  const origin = headers.get('origin')
  if (origin !== null && !isTrustedOrigin(origin, additionalAllowedHosts)) {
    return {
      ok: false,
      reason: `refused a request from ${origin}: git actions only run for the git-graph page itself`,
    }
  }

  if (headers.get(MUTATION_REQUEST_HEADER) !== MUTATION_REQUEST_HEADER_VALUE) {
    return {
      ok: false,
      reason: `refused: a git action needs the ${MUTATION_REQUEST_HEADER} header the git-graph client sends`,
    }
  }

  const contentType = headers.get('content-type') ?? ''
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return { ok: false, reason: 'refused: a git action must be sent as application/json' }
  }

  return { ok: true }
}
