import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { parseAllowedOrigins } from './services/cors'
import {
  createListedRepositorySet,
  createServedRootRepositorySet,
  type RepositorySet,
} from './services/repository-set'

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
  // A file naming exactly the repositories to serve, one absolute path per line
  // (services/repository-set.ts). When set it replaces the root scan entirely —
  // GIT_GRAPH_ROOT is not consulted — and the repository identifier becomes the
  // absolute path. Re-read on every request, so a supervising host (nightshift-ui)
  // can keep it in step with its own project list without a restart. Empty (the
  // default) serves the root.
  GIT_GRAPH_REPOSITORIES_FILE: z
    .string()
    .default('')
    .describe('File listing the absolute paths of the repositories to serve, one per line; replaces the root scan.'),
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
  // Extra Host header values the server answers for, beside the loopback names.
  // Two jobs: the acknowledgement a non-loopback bind needs to start (ADR-0037
  // §4), and the per-request allowlist of the DNS-rebinding guard
  // (services/trusted-host.ts, issue #5). Empty by default: git-graph answers
  // for loopback names only. A proxied deployment names its own domain here —
  // including a loopback bind behind a proxy that passes its public Host through.
  GIT_GRAPH_ALLOWED_HOSTS: z
    .string()
    .default('')
    .describe('Comma-separated host name(s) acknowledged when binding a non-loopback address.'),
  // Exact origins of embedding hosts (services/cors.ts): pages served elsewhere
  // that may read this API and request a checkout across origins. Each entry is
  // a serialised origin (`http://127.0.0.1:3115`); a malformed one fails the boot.
  // Empty by default: no CORS at all, and the checkout admits only the git-graph
  // page itself. This never widens which Host the server answers for.
  GIT_GRAPH_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .describe('Comma-separated exact origins of embedding hosts granted cross-origin reads and checkout.'),
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
  GIT_GRAPH_REPOSITORIES_FILE: process.env.GIT_GRAPH_REPOSITORIES_FILE || undefined,
  GIT_GRAPH_ALLOWED_HOSTS: process.env.GIT_GRAPH_ALLOWED_HOSTS || undefined,
  GIT_GRAPH_ALLOWED_ORIGINS: process.env.GIT_GRAPH_ALLOWED_ORIGINS || undefined,
})

// Parsed once here rather than re-split per request.
export const additionalAllowedHosts = config.GIT_GRAPH_ALLOWED_HOSTS.split(',')
  .map((allowedHost) => allowedHost.trim())
  .filter((allowedHost) => allowedHost !== '')

// Validated here, so a malformed entry fails the boot rather than silently
// admitting nothing.
export const allowedOrigins = parseAllowedOrigins(config.GIT_GRAPH_ALLOWED_ORIGINS)

// The repositories every request's identifier is resolved against. Built at
// startup, so a missing root or an unreadable/malformed repositories file fails
// the boot, not a request.
export const servedRepositories: RepositorySet =
  config.GIT_GRAPH_REPOSITORIES_FILE !== ''
    ? createListedRepositorySet(config.GIT_GRAPH_REPOSITORIES_FILE)
    : createServedRootRepositorySet(config.GIT_GRAPH_ROOT)

export const isDev = config.NODE_ENV !== 'production'
