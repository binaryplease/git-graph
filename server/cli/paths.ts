/**
 * Filesystem locations and on-disk state for the CLI's background daemon.
 *
 * Two ADRs shape this module:
 *   - ADR-0011 — the path to the service script is resolved against the CLI's
 *     own real location (following symlinks), never the shell's cwd, so a
 *     symlinked `bgg` on PATH still finds its sibling `index.{ts,js}`.
 *   - ADR-0015 — the PID/log path conventions, and the "daemon logic lives in
 *     its own module" split (probe/start/stop live in ./daemon.ts).
 *
 * A companion state file sits beside the PID file: the PID file holds only the
 * pid (ADR-0015), while the state file records the port/host/root/startedAt the
 * daemon was launched with, so `status`, `stop`, and `logs` can reach the right
 * server without re-guessing its port.
 */
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'

const DAEMON_NAME = 'git-graph'

/**
 * Directory of the running CLI file, resolved through any symlink (ADR-0011).
 * Falls back to this module's own URL when `Bun.argv[1]` cannot be realpath'd
 * (e.g. an odd embedding), so path resolution never throws at startup.
 */
const cliFilePath = (() => {
  try {
    return realpathSync(Bun.argv[1])
  } catch {
    return fileURLToPath(import.meta.url)
  }
})()

// The server entry sits next to the CLI entry in every layout: `server/cli.ts`
// beside `server/index.ts` in the source tree, `cli.js` beside `index.js` in
// the built `dist/server`. Matching the CLI file's own extension picks the
// right one without probing the disk.
export const serviceScriptPath = join(dirname(cliFilePath), `index${extname(cliFilePath)}`)

const runtimeDirectory = process.env.XDG_RUNTIME_DIR || '/tmp'
const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')

export const pidFilePath = join(runtimeDirectory, `${DAEMON_NAME}.pid`)
export const stateFilePath = join(runtimeDirectory, `${DAEMON_NAME}.state.json`)
export const logDirectory = join(dataHome, DAEMON_NAME)
export const logFilePath = join(logDirectory, `${DAEMON_NAME}.log`)

/**
 * A private, per-launch path the server writes its bound port to (the CLI
 * handshake). Keyed by the launching CLI's pid so concurrent `bgg` invocations
 * never read each other's file.
 */
export function readyFilePathFor(uniqueSuffix: string | number): string {
  return join(runtimeDirectory, `${DAEMON_NAME}.ready.${uniqueSuffix}`)
}

// Identity fields, no defaults (ADR-0029): a corrupt or partial state file must
// fail loudly rather than resolve to a bogus zero-port daemon.
export const DaemonStateSchema = z.object({
  pid: z.number().int().positive(),
  host: z.string().min(1),
  port: z.number().int().positive(),
  root: z.string().min(1),
  startedAt: z.string().min(1),
})
export type DaemonState = z.infer<typeof DaemonStateSchema>

/** The daemon's base URL, from its recorded host/port. */
export function baseUrlForState(state: Pick<DaemonState, 'host' | 'port'>): string {
  return `http://${state.host}:${state.port}`
}
