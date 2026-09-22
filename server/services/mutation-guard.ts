import {
  MUTATION_REQUEST_HEADER,
  MUTATION_REQUEST_HEADER_VALUE,
} from '../../shared/mutationRequest'

// The cross-origin gate in front of every mutating route. Its own module
// (ADR-0032): it depends on nothing but request headers, and it would work
// unchanged if the git service it protects were deleted. The membership guards
// decide *what* a write may touch; this decides *who* may ask for one.
//
// Three independent checks, each sufficient against a foreign page on its own
// in the browsers that honour it — they are layered, not alternatives:
//
//   1. The custom header (`shared/mutationRequest.ts`). A cross-origin page
//      cannot set it without a CORS preflight, and this service answers none.
//   2. A JSON content type. Same reason: `application/json` is not a "simple"
//      content type, so a form post or a `no-cors` fetch cannot carry it.
//   3. `Sec-Fetch-Site`, when the browser sends it, must say `same-origin`. A
//      browser that knows the request came from another site says so, and that
//      is refused outright rather than left to the preflight.
//
// Not in scope here: DNS rebinding, where the attacker's page *is* same-origin
// with the service as far as the browser can tell. That needs the Host-header
// guard tracked in issue #5; this gate does not pretend to cover it.

export type MutationRequestVerdict = { ok: true } | { ok: false; reason: string }

/** Decide whether a request may reach a mutating route. Pure: headers in, verdict out. */
export function checkMutationRequest(headers: Headers): MutationRequestVerdict {
  const fetchSite = headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') {
    return {
      ok: false,
      reason: `refused a ${fetchSite} request: git actions only run for the git-graph page itself`,
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
