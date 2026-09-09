// Startup exposure policy for the bind address (ADR-0037 §4).
//
// git-graph is an UNAUTHENTICATED API: it lists the git repositories at a
// served root and returns their commit history, file diffs, and working-tree
// changes to anyone who can reach the port. Nothing in the request path
// authenticates the caller, so the loopback bind is the only access control in
// play. Binding a non-loopback address — whether by an explicit `HOST=0.0.0.0`
// or a copied config — publishes every repo under the served root to every peer
// on the network.
//
// The rule, evaluated once at startup and never per request (ADR-0018): a
// non-loopback bind with no acknowledged hosts is a fatal startup error. Naming
// the served host(s) in `GIT_GRAPH_ALLOWED_HOSTS` is the deliberate
// acknowledgement that an authenticating reverse proxy sits in front — the
// documented hosted deployment. Loopback (the default) always serves.
//
// The loopback check lives here rather than in a shared trusted-host module:
// git-graph has no DNS-rebinding Host guard of its own, and this decision needs
// only `node:*`-free string logic, so per ADR-0032 it stays a self-contained,
// dependency-light unit.

// Loopback literals a bind address is written as. The whole 127.0.0.0/8 block is
// loopback, not just 127.0.0.1; `::1`/`[::1]` cover IPv6.
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

// A bind address carries no port, so a Host-header parser (which would eat `::1`
// at its first colon) is the wrong tool. Case and whitespace still need
// normalising before the loopback set is consulted.
function normaliseBindHostname(bindHost: string): string {
  return bindHost.trim().toLowerCase()
}

export function isLoopbackAddress(bindHost: string): boolean {
  const hostname = normaliseBindHostname(bindHost)
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true
  const octets = hostname.split('.')
  if (octets.length !== 4) return false
  if (octets[0] !== '127') return false
  return octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

export type BindExposureDecision =
  | { kind: 'loopback' }
  | { kind: 'refused'; reason: string }
  | { kind: 'exposed'; warnings: string[] }

const NON_LOOPBACK_REFUSAL = (bindHost: string) =>
  `refusing to start: HOST=${bindHost} is not a loopback address, and ` +
  'GIT_GRAPH_ALLOWED_HOSTS is empty.\n\n' +
  'git-graph is an UNAUTHENTICATED git API. Binding a non-loopback ' +
  'address publishes every repository under the served root — commit history, ' +
  'diffs, and working-tree changes — to every peer that can reach this port.\n\n' +
  'To run this way deliberately:\n' +
  '  1. Put an AUTHENTICATING reverse proxy (e.g. Caddy) in front of this ' +
  'port, and make sure the port itself is not reachable from anywhere else.\n' +
  '  2. Set GIT_GRAPH_ALLOWED_HOSTS to the host name(s) that proxy serves ' +
  '(e.g. GIT_GRAPH_ALLOWED_HOSTS=graph.example.com) to acknowledge it.\n\n' +
  'To run locally instead, leave HOST unset (defaults to 127.0.0.1).'

const EXPOSED_WARNING = (bindHost: string) =>
  `WARNING: bound to a non-loopback address (HOST=${bindHost}).\n` +
  '  git-graph authenticates nothing itself — the reverse proxy in front ' +
  'is the only thing between the network and every served repository. Make sure ' +
  'it authenticates every request and that this port is not reachable directly.'

// Pure decision (ADR-0010): no logging, no exiting, so tests can assert on it.
export function evaluateBindExposure(options: {
  bindHost: string
  additionalAllowedHosts: string[]
}): BindExposureDecision {
  const { bindHost, additionalAllowedHosts } = options

  if (isLoopbackAddress(bindHost)) return { kind: 'loopback' }

  if (additionalAllowedHosts.length === 0) {
    return { kind: 'refused', reason: NON_LOOPBACK_REFUSAL(bindHost) }
  }

  return { kind: 'exposed', warnings: [EXPOSED_WARNING(bindHost)] }
}

// Factory per ADR-0007. Orchestration half: turns the decision into the process
// outcome — a fatal exit or a warning on stderr. Injectable sinks keep it
// testable without killing the test runner.
export function createBindExposurePolicy(
  options: {
    reportWarning?: (message: string) => void
    fail?: (message: string) => never
  } = {},
) {
  const reportWarning = options.reportWarning ?? ((message: string) => console.warn(message))
  const exitFatally = (message: string): never => {
    console.error(message)
    process.exit(1)
  }
  const fail = options.fail ?? exitFatally

  return {
    // Call before listen(). Returns only when it is safe to serve.
    enforce(bindOptions: {
      bindHost: string
      additionalAllowedHosts: string[]
    }): BindExposureDecision {
      const decision = evaluateBindExposure(bindOptions)
      if (decision.kind === 'refused') fail(decision.reason)
      if (decision.kind === 'exposed') decision.warnings.forEach(reportWarning)
      return decision
    },
  }
}
