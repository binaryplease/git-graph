import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'

// Boundary validation of the process environment (ADR-0013). Parsed once at
// startup; a malformed env fails loud here rather than deep in a request path.
const EnvironmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3010),
  // Loopback by default even in prod — Caddy on the same host is the only thing
  // that should reach this process (ADR-0037 §4). A non-loopback HOST is a fatal
  // startup error unless GIT_GRAPH_ALLOWED_HOSTS acknowledges it; see
  // services/bind-exposure.ts.
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Directory scanned for git repositories (the root itself plus its direct
  // children). Defaults to ~/Developer, the usual projects folder; set it (or
  // pass a positional CLI argument) to point somewhere else.
  GIT_GRAPH_ROOT: z.string().min(1).default(join(homedir(), 'Developer')),
  // How the server chooses its listen port (ADR-0037 §3). `auto` (the default,
  // and every launch shape — a bare `bun server/index.ts`, `mise run start`, and
  // the `bgg` CLI) walks upward from PORT to the first free port, announcing each
  // skip, so a stale dev session or a fleet of instances never turns the operator
  // into a manual port allocator. `strict` binds PORT exactly and dies loudly on
  // a conflict (ADR-0018); it is reserved for an explicit operator pin (`bgg
  // --port`, or GIT_GRAPH_PORT_STRATEGY=strict). Either way the runtime bind is
  // exclusive and never falls back silently.
  GIT_GRAPH_PORT_STRATEGY: z
    .enum(['strict', 'auto'])
    .default('auto')
    .describe('Port selection: `auto` walks to a free port (announced); `strict` binds PORT exactly.'),
  // When set, the server writes the port it actually bound to this file the
  // instant it starts listening. The CLI passes a private path here so it can
  // learn an auto-assigned port (and confirm a strict one) without parsing
  // stdout. Empty (the default) writes nothing.
  GIT_GRAPH_READY_FILE: z
    .string()
    .default('')
    .describe('Path the server writes its bound port to once listening (for the CLI handshake).'),
  // Extra Host header values the operator acknowledges when binding a
  // non-loopback address (ADR-0037 §4). Empty by default: git-graph is
  // loopback-only, and a non-loopback bind with no named hosts refuses to start.
  // Only the documented HOST=0.0.0.0-behind-an-authenticating-proxy deployment
  // needs this, and that operator must name their own domain.
  GIT_GRAPH_ALLOWED_HOSTS: z
    .string()
    .default('')
    .describe('Comma-separated host name(s) acknowledged when binding a non-loopback address.'),
})

export type Config = z.infer<typeof EnvironmentSchema>

export const config: Config = EnvironmentSchema.parse({
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  NODE_ENV: process.env.NODE_ENV,
  // First positional argument wins (`bun server/index.ts ~/projects`), then
  // the environment, then the schema default (home directory).
  GIT_GRAPH_ROOT: process.argv[2] || process.env.GIT_GRAPH_ROOT || undefined,
  GIT_GRAPH_PORT_STRATEGY: process.env.GIT_GRAPH_PORT_STRATEGY || undefined,
  GIT_GRAPH_READY_FILE: process.env.GIT_GRAPH_READY_FILE || undefined,
  GIT_GRAPH_ALLOWED_HOSTS: process.env.GIT_GRAPH_ALLOWED_HOSTS || undefined,
})

// Parsed once here rather than re-split per request.
export const additionalAllowedHosts = config.GIT_GRAPH_ALLOWED_HOSTS.split(',')
  .map((allowedHost) => allowedHost.trim())
  .filter((allowedHost) => allowedHost !== '')

export const isDev = config.NODE_ENV !== 'production'
