import { isLoopbackAddress } from './bind-exposure'

// DNS-rebinding defence for a loopback-bound, unauthenticated server (issue #5).
//
// Binding to 127.0.0.1 keeps other machines out, and shipping no CORS headers
// keeps the same-origin policy between a foreign page and our responses. Neither
// survives DNS rebinding: an attacker points `evil.example` at 127.0.0.1, the
// user's browser treats `http://evil.example:3010` as that name's *own* server,
// and the same-origin policy stops applying. Every read route — the repository
// listing, history, diffs, working-tree contents — then answers the attacker's
// page, and the checkout route's cross-origin gate passes too, because the
// browser honestly reports the request as `same-origin`.
//
// The one signal that still tells the two apart is the `Host` header: a rebound
// request carries the attacker's name, never a loopback one. So the server
// answers only for the names it is actually reachable under — the loopback
// literals plus whatever the operator named in `GIT_GRAPH_ALLOWED_HOSTS`, the
// same variable that acknowledges a proxied non-loopback bind (ADR-0037 §4).
//
// Pure decisions only (ADR-0010): strings in, verdict out. The rejection itself
// is wired in server/index.ts, before routing; the mutation guard reuses
// `isTrustedOrigin` for the `Origin` header.

// `name[:port]` and `[ipv6][:port]`, lower-cased. Anything else — credentials,
// a path, whitespace, a comma from a repeated header, an unbracketed IPv6
// literal — is not an authority this server was addressed by, and is refused
// rather than trimmed into one. An unbracketed `::1:3010` in particular must not
// be split at its first colon.
const NAME_AUTHORITY_PATTERN = /^([a-z0-9._-]+)(?::(\d{1,5}))?$/
const BRACKETED_AUTHORITY_PATTERN = /^(\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/

/**
 * The hostname a `Host` header (or `X-Forwarded-Host` entry) names, without its
 * port, or `null` when the value is not a well-formed authority. A bracketed IPv6
 * literal keeps its brackets (`[::1]`), the form a Host header carries.
 */
export function hostnameFromHostHeader(hostHeader: string): string | null {
  const authority = hostHeader.trim().toLowerCase()
  const match = BRACKETED_AUTHORITY_PATTERN.exec(authority) ?? NAME_AUTHORITY_PATTERN.exec(authority)
  return match?.[1] ?? null
}

// An operator entry may be written bare (`graph.example.com`), with a port, or as
// an unbracketed IPv6 literal (`fe80::1`) — the last is bracketed so it compares
// in the form a Host header carries.
function hostnameFromAllowedHost(allowedHost: string): string | null {
  const trimmedHost = allowedHost.trim().toLowerCase()
  const isBareIpv6 = !trimmedHost.startsWith('[') && trimmedHost.split(':').length > 2
  return hostnameFromHostHeader(isBareIpv6 ? `[${trimmedHost}]` : trimmedHost)
}

/**
 * Whether the server answers for `hostname`: a loopback literal (`localhost`, the
 * 127.0.0.0/8 block, `[::1]`) or a name in `GIT_GRAPH_ALLOWED_HOSTS`. Matched
 * exactly — `evil.localhost` or `localhost.` is a name an attacker can point at
 * 127.0.0.1, so suffix matching would reopen the hole this closes.
 */
export function isTrustedHostname(hostname: string, additionalAllowedHosts: string[]): boolean {
  if (isLoopbackAddress(hostname)) return true
  return additionalAllowedHosts.some((allowedHost) => hostnameFromAllowedHost(allowedHost) === hostname)
}

export type RequestHostVerdict =
  | { ok: true; authority: string }
  | { ok: false; statusCode: 400 | 421; reason: string }

/**
 * Decide whether a request may be answered at all, from its `Host` header.
 *
 * A request with no `Host` is refused (400). HTTP/1.1 requires the header and
 * every browser sends it, so its absence means a hand-rolled client — and with
 * nothing to check, the request cannot be told apart from a rebound one. A local
 * script that wants an answer sends `Host: localhost` like any HTTP/1.1 client.
 *
 * On success the verdict carries the authority as sent (port included), which is
 * what the discovery document may then name.
 */
export function evaluateRequestHost(hostHeader: string | null, additionalAllowedHosts: string[]): RequestHostVerdict {
  if (hostHeader === null || hostHeader.trim() === '') {
    return { ok: false, statusCode: 400, reason: 'refused: the request carries no Host header' }
  }
  const hostname = hostnameFromHostHeader(hostHeader)
  if (hostname === null) {
    return { ok: false, statusCode: 400, reason: 'refused: the Host header is not a host name' }
  }
  if (!isTrustedHostname(hostname, additionalAllowedHosts)) {
    return {
      ok: false,
      statusCode: 421,
      reason:
        `refusing to answer for Host ${hostname}: git-graph serves loopback names only; ` +
        'set GIT_GRAPH_ALLOWED_HOSTS to serve another name deliberately',
    }
  }
  return { ok: true, authority: hostHeader.trim().toLowerCase() }
}

/**
 * Whether an `Origin` header names a host this server answers for. The scheme
 * must be http(s) — an opaque `null` origin (a sandboxed frame, a `file:` page)
 * names no host and is not trusted. The port is not compared: the threat is a
 * foreign *name*, and a proxied deployment's public port is not this process's.
 */
export function isTrustedOrigin(origin: string, additionalAllowedHosts: string[]): boolean {
  if (!URL.canParse(origin)) return false
  const url = new URL(origin)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const hostname = hostnameFromHostHeader(url.host)
  return hostname !== null && isTrustedHostname(hostname, additionalAllowedHosts)
}

// Factory per ADR-0007. Binds the operator's allowlist once at startup so the
// request path only supplies the header.
export function createTrustedHostGuard(options: { additionalAllowedHosts: string[] }) {
  const { additionalAllowedHosts } = options
  return {
    evaluate(hostHeader: string | null): RequestHostVerdict {
      return evaluateRequestHost(hostHeader, additionalAllowedHosts)
    },
  }
}
