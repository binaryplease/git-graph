/**
 * Port probing — "can this process bind here?" and "find the first free port".
 *
 * This capability depends only on `node:net`, not on the dev-server harness or
 * the CLI that use it, so per ADR-0032 it lives in its own module rather than
 * inside `scripts/dev-ports.ts`. Both the dev port resolver and the standalone
 * CLI's auto-port assignment compose these functions.
 *
 * ADR-0018 stays intact: probing never *replaces* a strict bind. A caller that
 * auto-assigns picks a concrete free port *before* startup and announces it;
 * the runtime bind that follows is still exclusive and still dies loudly if the
 * chosen port was stolen between the probe and the bind (ADR-0037).
 */
import { createServer } from 'node:net'

/** How far above the requested port we search before giving up. */
export const PORT_SEARCH_SPAN = 50

/**
 * True when nothing is listening on `port` for `host`.
 *
 * Uses a real bind rather than a connect probe: a connect probe cannot tell an
 * unbound port from one bound by a process that refuses connections, and the
 * question we actually care about is "can our server bind here".
 */
export function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const probeServer = createServer()
    probeServer.once('error', () => resolvePromise(false))
    probeServer.once('listening', () => probeServer.close(() => resolvePromise(true)))
    // exclusive: true — never let SO_REUSEPORT-style sharing mask a conflict
    // (ADR-0018).
    probeServer.listen({ port, host, exclusive: true })
  })
}

/**
 * The first free port at or above `requestedPort`, skipping anything in
 * `reservedPorts` (ports already handed to a sibling process in this run, which
 * nothing is listening on yet).
 *
 * Throws when the whole search span is occupied — an environment that broken
 * should stop the caller, not be worked around.
 */
export async function findAvailablePort(
  requestedPort: number,
  host: string,
  reservedPorts: ReadonlySet<number> = new Set(),
): Promise<number> {
  for (
    let candidatePort = requestedPort;
    candidatePort < requestedPort + PORT_SEARCH_SPAN;
    candidatePort++
  ) {
    if (reservedPorts.has(candidatePort)) continue
    if (await isPortAvailable(candidatePort, host)) return candidatePort
  }
  throw new Error(
    `No free port found in ${requestedPort}-${requestedPort + PORT_SEARCH_SPAN - 1} on ${host}. ` +
      'Something is occupying the whole range — check for runaway servers.',
  )
}
