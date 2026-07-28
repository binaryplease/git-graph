/**
 * Bind the server's listen port, per the configured strategy, and report the
 * port actually bound (ADR-0037).
 *
 * `strict` binds the requested port exactly and lets Elysia's EADDRINUSE throw
 * (ADR-0018 — a conflict is a fatal startup error). `auto` (the default, and
 * what a bare launch, `mise run start`, and the `bgg` CLI all use) walks upward
 * from the requested port to the first free one, announcing each skip and
 * binding in-process — so a fleet of concurrently-launched instances converges
 * on distinct ports in microseconds, without the reload-per-collision cost of
 * probing-then-respawning from outside. Auto never falls back *silently* — every
 * reassignment is printed — so the ADR-0018 posture holds: allocation runs in
 * front of the strict bind, never as a quiet recovery after it (ADR-0037 §3).
 * `strict` is reserved for an explicit operator pin (`--port`, or
 * `GIT_GRAPH_PORT_STRATEGY=strict`).
 *
 * The bind stays exclusive either way (`reusePort: false`) — Elysia's Bun
 * adapter otherwise defaults `reusePort` to true, which would let a second
 * process share the port via SO_REUSEPORT and mask a real conflict.
 */
import { PORT_SEARCH_SPAN } from './port'

export type ListenStrategy = 'strict' | 'auto'

// Only the shape `listenWithStrategy` uses — a structural slice of Elysia's
// `listen`, so this module stays decoupled from Elysia's large generic type.
type ListenableApp = {
  listen(options: {
    port: number
    hostname: string
    development: boolean
    reusePort: boolean
  }): unknown
}

function isAddressInUse(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'EADDRINUSE'
}

/**
 * Listen and return the bound port. `announce` is called with each port skipped
 * in auto mode so the reassignment is visible (never silent).
 */
export function listenWithStrategy(
  app: ListenableApp,
  options: {
    host: string
    requestedPort: number
    strategy: ListenStrategy
    isDev: boolean
    announce?: (skippedPort: number) => void
  },
): number {
  const listenOn = (port: number) =>
    app.listen({
      port,
      hostname: options.host,
      development: options.isDev,
      // See the module note: keep the bind exclusive so conflicts surface.
      reusePort: false,
    })

  if (options.strategy === 'strict') {
    listenOn(options.requestedPort)
    return options.requestedPort
  }

  const lastPort = options.requestedPort + PORT_SEARCH_SPAN - 1
  for (let candidatePort = options.requestedPort; candidatePort <= lastPort; candidatePort++) {
    try {
      listenOn(candidatePort)
      return candidatePort
    } catch (listenError) {
      if (!isAddressInUse(listenError)) throw listenError
      options.announce?.(candidatePort)
    }
  }
  throw new Error(
    `No free port found in ${options.requestedPort}-${lastPort} on ${options.host}. ` +
      'Something is occupying the whole range — check for runaway servers.',
  )
}
