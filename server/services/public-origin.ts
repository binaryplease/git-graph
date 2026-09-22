import { hostnameFromHostHeader, isTrustedHostname } from './trusted-host'

// Which origin the ADR-0020 discovery document advertises.
//
// `GET /api` must return absolute URLs, so it has to name an origin. A proxy
// (Caddy in the hosted deployment) says which one through `x-forwarded-host` /
// `x-forwarded-proto` — but those are plain request headers any client can set,
// and nothing validated them: a request could make the document name any host
// it liked. So they get the same allowlist as `Host` (services/trusted-host.ts):
// a forwarded host is honoured only when the server would itself answer for it,
// and otherwise the validated `Host` names the origin. The worst a caller can
// then choose is a name the server already serves — no gain for an attacker.
//
// Pure (ADR-0010): headers in, origin out.

// Proxies append rather than replace, so `x-forwarded-*` can be a list; the
// left-most entry is the one closest to the client.
function firstForwardedValue(headerValue: string | null): string {
  return headerValue?.split(',')[0]?.trim().toLowerCase() ?? ''
}

export function resolvePublicOrigin(options: {
  requestUrl: string
  /** The `Host` header, already admitted by the trusted-host guard. */
  hostHeader: string | null
  forwardedProtocolHeader: string | null
  forwardedHostHeader: string | null
  additionalAllowedHosts: string[]
}): string {
  const { requestUrl, hostHeader, forwardedProtocolHeader, forwardedHostHeader, additionalAllowedHosts } = options
  const url = new URL(requestUrl)
  const ownAuthority = hostHeader?.trim().toLowerCase() || url.host

  const forwardedAuthority = firstForwardedValue(forwardedHostHeader)
  const forwardedHostname = forwardedAuthority === '' ? null : hostnameFromHostHeader(forwardedAuthority)
  const authority =
    forwardedHostname !== null && isTrustedHostname(forwardedHostname, additionalAllowedHosts)
      ? forwardedAuthority
      : ownAuthority

  // The scheme lands in a URL handed to clients, so only the two this server
  // can be reached under are taken from the header.
  const forwardedProtocol = firstForwardedValue(forwardedProtocolHeader)
  const protocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https' ? forwardedProtocol : url.protocol.replace(':', '')

  return `${protocol}://${authority}`
}
