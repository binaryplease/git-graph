/**
 * Background-daemon lifecycle for the CLI (ADR-0015): probe, start, stop,
 * restart, and log tail for a single detached git-graph server.
 *
 * The daemon is a singleton per user — one background server on a recorded
 * port. Running many graphs at once is the *foreground* command's job
 * (`bgg [path]`), where each process auto-assigns its own free port; the daemon
 * is the "keep one running in the background" convenience, not the multi-
 * instance mechanism. `daemon start` is idempotent: it restarts a daemon that
 * is already up rather than colliding with it.
 *
 * Spawn/kill hygiene follows ADR-0015 exactly: `process.execPath` (not the
 * string "bun") so the right runtime is used regardless of install path,
 * `detached: true` + `unref()` so the daemon outlives the terminal, and signals
 * sent to the whole process group so any grandchildren the server spawned
 * (openers, git subprocesses) go down with it.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import {
  DaemonStateSchema,
  baseUrlForState,
  logDirectory,
  logFilePath,
  pidFilePath,
  readyFilePathFor,
  serviceScriptPath,
  stateFilePath,
  type DaemonState,
} from './paths'

export type DaemonProbe =
  | { running: false }
  | { running: true; pid: number; state: DaemonState | null }

/** True when a process with `pid` exists and we may signal it. */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (probeError) {
    // EPERM means the process exists but is owned by someone else — still alive.
    return (probeError as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readRecordedState(): Promise<DaemonState | null> {
  if (!existsSync(stateFilePath)) return null
  try {
    const parsed = DaemonStateSchema.safeParse(await Bun.file(stateFilePath).json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function removeQuietly(filePath: string): void {
  try {
    rmSync(filePath, { force: true })
  } catch {
    // Best-effort cleanup — a missing or unremovable stale file must not throw.
  }
}

/**
 * Read the PID file, confirm the process is alive (signal 0), and clean up
 * stale PID/state files when it is not. Returns the recorded state alongside a
 * live pid so callers can reach the daemon's port.
 */
export async function daemonProbe(): Promise<DaemonProbe> {
  if (!existsSync(pidFilePath)) return { running: false }
  const recordedPid = Number((await Bun.file(pidFilePath).text()).trim())
  if (!Number.isInteger(recordedPid) || recordedPid <= 0 || !processIsAlive(recordedPid)) {
    removeQuietly(pidFilePath)
    removeQuietly(stateFilePath)
    return { running: false }
  }
  return { running: true, pid: recordedPid, state: await readRecordedState() }
}

/** Poll `${baseUrl}/api/health` until it answers `{ ok: true }` or time runs out. */
export async function waitForHealth(baseUrl: string, timeoutMilliseconds = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return true
    } catch {
      // Not listening yet — keep polling until the deadline.
    }
    await Bun.sleep(100)
  }
  return false
}

/**
 * The port a just-spawned server actually bound, learned from the ready file it
 * writes the instant it listens, or null if it exited first without binding.
 * The server owns port selection (walking past busy ports in-process under the
 * `auto` strategy), so reading the port it reports — rather than probing then
 * hoping the probe still holds — is what makes concurrent launches converge on
 * distinct ports without a reload per collision (ADR-0037).
 */
export async function awaitBoundPort(
  serverProcess: Bun.Subprocess,
  readyFilePath: string,
  timeoutMilliseconds = 15000,
): Promise<number | null> {
  let exited = false
  void serverProcess.exited.then(() => {
    exited = true
  })
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (existsSync(readyFilePath)) {
      const reportedPort = Number((await Bun.file(readyFilePath).text()).trim())
      if (Number.isInteger(reportedPort) && reportedPort > 0) return reportedPort
    }
    if (exited) return null
    await Bun.sleep(50)
  }
  return null
}

/**
 * Environment for a spawned server. The root travels here (never argv, so a
 * clean spawn can't be mistaken for a subcommand); the strategy is `auto`
 * unless an explicit port pins it to `strict`; and the ready-file path is how
 * the server hands its bound port back.
 */
export function serverLaunchEnvironment(options: {
  host: string
  root: string
  explicitPort: number | undefined
  basePort: number
  readyFilePath: string
}): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    NODE_ENV: 'production',
    HOST: options.host,
    PORT: String(options.explicitPort ?? options.basePort),
    GIT_GRAPH_ROOT: options.root,
    GIT_GRAPH_PORT_STRATEGY: options.explicitPort === undefined ? 'auto' : 'strict',
    GIT_GRAPH_READY_FILE: options.readyFilePath,
  }
}

/** SIGKILL a failed launch attempt and wait for it to actually be gone. */
export async function discardServerProcess(serverProcess: Bun.Subprocess): Promise<void> {
  try {
    serverProcess.kill('SIGKILL')
  } catch {
    // Already exited.
  }
  await serverProcess.exited
}

/** Process-group id of `pid`, or the pid itself when `ps` cannot report one. */
function processGroupId(pid: number): number {
  const result = Bun.spawnSync(['ps', '-o', 'pgid=', '-p', String(pid)], { stderr: 'ignore' })
  const parsedGroupId = Number.parseInt(result.stdout.toString().trim(), 10)
  return Number.isNaN(parsedGroupId) ? pid : parsedGroupId
}

/**
 * SIGTERM the daemon's process group, wait up to 3s for it to exit, then
 * escalate to SIGKILL. Returns false only when the initial signal cannot be
 * delivered (the process is already gone).
 */
async function killProcessGroup(pid: number): Promise<boolean> {
  const groupId = processGroupId(pid)
  try {
    process.kill(-groupId, 'SIGTERM')
  } catch {
    return false
  }
  for (let attempt = 0; attempt < 15; attempt++) {
    await Bun.sleep(200)
    if (!processIsAlive(pid)) return true
  }
  try {
    process.kill(-groupId, 'SIGKILL')
  } catch {
    // Already gone between the last poll and here.
  }
  return true
}

export type StartDaemonOptions = {
  root: string
  host: string
  /** Explicit port (strict) or undefined to auto-assign a free one. */
  explicitPort: number | undefined
  /** Base port to search upward from when auto-assigning. */
  basePort: number
}

export type StartDaemonResult =
  | { started: false }
  | { started: true; pid: number; baseUrl: string; port: number; healthy: boolean }

/**
 * Fork the server into the background, record its pid + state at the port it
 * actually bound, and wait for it to answer health. Idempotent: a daemon that
 * is already running is stopped first. The server owns port selection (walking
 * past busy ports in-process under `auto`), so there is no external probe/retry
 * loop; `started: false` means it exited before binding (a strict-port
 * conflict, or a fatal startup — inspect the log).
 */
export async function startDaemon(options: StartDaemonOptions): Promise<StartDaemonResult> {
  const existing = await daemonProbe()
  if (existing.running) await stopDaemon()

  mkdirSync(logDirectory, { recursive: true })

  const readyFilePath = readyFilePathFor(`daemon.${process.pid}`)
  removeQuietly(readyFilePath)

  const daemonProcess = Bun.spawn([process.execPath, serviceScriptPath], {
    stdout: Bun.file(logFilePath),
    stderr: Bun.file(logFilePath),
    stdin: 'ignore',
    detached: true,
    env: serverLaunchEnvironment({ ...options, readyFilePath }),
  })

  const port = await awaitBoundPort(daemonProcess, readyFilePath)
  removeQuietly(readyFilePath)
  if (port === null) {
    await discardServerProcess(daemonProcess)
    return { started: false }
  }

  const state: DaemonState = {
    pid: daemonProcess.pid,
    host: options.host,
    port,
    root: options.root,
    startedAt: new Date().toISOString(),
  }
  await Bun.write(pidFilePath, String(daemonProcess.pid))
  await Bun.write(stateFilePath, JSON.stringify(state, null, 2))
  daemonProcess.unref()

  const baseUrl = baseUrlForState(state)
  const healthy = await waitForHealth(baseUrl)
  return { started: true, pid: daemonProcess.pid, baseUrl, port, healthy }
}

/** Stop the running daemon (graceful, then forced). Returns false if none was running. */
export async function stopDaemon(): Promise<boolean> {
  const probe = await daemonProbe()
  if (!probe.running) return false
  const stopped = await killProcessGroup(probe.pid)
  removeQuietly(pidFilePath)
  removeQuietly(stateFilePath)
  return stopped
}

/** Last `lineCount` lines of the daemon log, or null when no log exists yet. */
export async function tailDaemonLog(lineCount: number): Promise<string | null> {
  if (!existsSync(logFilePath)) return null
  const logText = await Bun.file(logFilePath).text()
  const lines = logText.split('\n')
  return lines.slice(Math.max(0, lines.length - lineCount)).join('\n')
}
