/**
 * `git-graph` command-line entry — the single executable the Nix package
 * installs as `bgg`.
 *
 * Two surfaces, per the on-demand-plus-daemon design:
 *
 *   bgg [path]                 Serve a directory in the foreground and open the
 *   bgg serve [path]           browser — the "run it where you are" gesture.
 *                              Defaults to the current directory. Auto-assigns a
 *                              free port so any number of these run at once.
 *                              Ctrl-C stops it.
 *
 *   bgg daemon start [path]    Background daemon lifecycle (ADR-0015): a single
 *   bgg daemon stop            keep-it-running server, hardened spawn/kill in
 *   bgg daemon restart         ./cli/daemon.ts.
 *   bgg daemon status
 *   bgg daemon logs [N]
 *
 *   bgg status                 Full operational view: daemon state + /api/status
 *                              snapshot + discovery links.
 *
 * Ports (ADR-0037): without an explicit --port the CLI lets the server resolve a
 * free port *before* it binds (auto-assignment, announced), so multiple
 * instances never collide. With --port the value is strict — the server binds it
 * and dies loudly on a conflict (ADR-0018). Either way the runtime bind stays
 * exclusive.
 *
 * The served root is where git repositories are scanned (the root itself plus
 * its direct children); it defaults to the current directory, so `bgg` in a
 * projects folder graphs everything under it. It binds loopback only.
 */
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { openUrlInBrowser } from './cli/browser'
import { baseUrlForState, readyFilePathFor, serviceScriptPath } from './cli/paths'
import { parseCli, type LaunchOptions } from './cli/args'
import {
  awaitBoundPort,
  daemonProbe,
  discardServerProcess,
  serverLaunchEnvironment,
  startDaemon,
  stopDaemon,
  tailDaemonLog,
  waitForHealth,
} from './cli/daemon'

const CLI_NAME = 'bgg'
const CLI_VERSION = '0.1.0'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_BASE_PORT = 3010

/** Resolve the served root: the given path (relative to cwd) or cwd itself. */
function resolveRoot(pathArgument: string | undefined): string {
  return resolve(process.cwd(), pathArgument ?? '.')
}

// --- Foreground serve (the default command) ---

async function runServe(invocation: LaunchOptions): Promise<never> {
  const root = resolveRoot(invocation.positionals[0])
  const basePort = Number(process.env.PORT) || DEFAULT_BASE_PORT
  const readyFilePath = readyFilePathFor(process.pid)

  const serverProcess = Bun.spawn([process.execPath, serviceScriptPath], {
    // Root and port strategy travel via the environment, never argv, so a clean
    // spawn can't be mistaken for a subcommand. The server owns port selection
    // (walking past busy ports in-process under `auto`) and reports the bound
    // port through the ready file — no external probe/retry needed.
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
    env: serverLaunchEnvironment({
      host: invocation.host,
      root,
      explicitPort: invocation.explicitPort,
      basePort,
      readyFilePath,
    }),
  })

  const port = await awaitBoundPort(serverProcess, readyFilePath)
  rmSync(readyFilePath, { force: true })

  if (port === null) {
    // Exited before binding — a strict-port conflict or a fatal startup, whose
    // reason the server already printed on the inherited stderr (ADR-0018).
    const exitCode = serverProcess.exitCode
    await discardServerProcess(serverProcess)
    process.exit(exitCode ?? 1)
  }

  const baseUrl = `http://${invocation.host}:${port}`

  // Forward terminal signals so Ctrl-C tears the server down cleanly and we
  // still exit with its code, rather than the CLI dying and orphaning it.
  const forwardSignal = (signal: NodeJS.Signals) => () => serverProcess.kill(signal)
  process.on('SIGINT', forwardSignal('SIGINT'))
  process.on('SIGTERM', forwardSignal('SIGTERM'))

  if (invocation.open) {
    // Fire-and-forget: opening the browser must never delay or block serving.
    waitForHealth(baseUrl).then((healthy) => {
      if (healthy && openUrlInBrowser(baseUrl)) {
        console.log(`${CLI_NAME}: opened ${baseUrl} — Ctrl-C to stop`)
      }
    })
  }

  await serverProcess.exited
  process.exit(serverProcess.exitCode ?? 0)
}

// --- Daemon subcommands (ADR-0015) ---

async function runDaemonStart(invocation: LaunchOptions): Promise<never> {
  const root = resolveRoot(invocation.positionals[0])
  const basePort = Number(process.env.PORT) || DEFAULT_BASE_PORT

  const result = await startDaemon({
    root,
    host: invocation.host,
    explicitPort: invocation.explicitPort,
    basePort,
  })
  if (!result.started) {
    console.error(
      `${CLI_NAME}: daemon failed to start — the server exited before binding. ` +
        `Inspect '${CLI_NAME} daemon logs'.`,
    )
    process.exit(1)
  }
  if (result.healthy) {
    console.log(`${CLI_NAME}: daemon running (pid ${result.pid}) at ${result.baseUrl}`)
    console.log(`  serving ${root}`)
    console.log(`  open ${result.baseUrl}  ·  stop with '${CLI_NAME} daemon stop'`)
    process.exit(0)
  }
  console.error(
    `${CLI_NAME}: daemon started (pid ${result.pid}) but did not answer health at ` +
      `${result.baseUrl}. Inspect '${CLI_NAME} daemon logs'.`,
  )
  process.exit(1)
}

async function runDaemonStop(): Promise<never> {
  const stopped = await stopDaemon()
  console.log(stopped ? `${CLI_NAME}: daemon stopped` : `${CLI_NAME}: no daemon was running`)
  process.exit(0)
}

async function runDaemonRestart(invocation: LaunchOptions): Promise<never> {
  // Preserve the running daemon's root/host when the restart names none, so a
  // bare `daemon restart` keeps serving what it was serving.
  const probe = await daemonProbe()
  const inheritedRoot =
    invocation.positionals[0] === undefined ? probe.running && probe.state?.root : undefined
  if (typeof inheritedRoot === 'string') invocation.positionals[0] = inheritedRoot
  return runDaemonStart(invocation)
}

async function runDaemonStatus(): Promise<never> {
  const probe = await daemonProbe()
  if (!probe.running) {
    console.log(`${CLI_NAME}: daemon not running`)
    process.exit(0)
  }
  console.log(`${CLI_NAME}: daemon running (pid ${probe.pid})`)
  if (!probe.state) {
    console.log('  state file missing — port unknown; stop and restart to re-record it')
    process.exit(0)
  }
  const baseUrl = baseUrlForState(probe.state)
  try {
    const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json())
    console.log(`  http: ok — ${JSON.stringify(health)} at ${baseUrl}`)
  } catch {
    console.log(`  http: not responding at ${baseUrl}`)
  }
  process.exit(0)
}

async function runDaemonLogs(invocation: LaunchOptions): Promise<never> {
  const requestedLines = Number(invocation.positionals[0])
  const lineCount = Number.isInteger(requestedLines) && requestedLines > 0 ? requestedLines : 200
  const logText = await tailDaemonLog(lineCount)
  if (logText === null) {
    console.log(`${CLI_NAME}: no daemon log yet`)
    process.exit(0)
  }
  console.log(logText)
  process.exit(0)
}

function runDaemon(
  action: 'start' | 'stop' | 'restart' | 'status' | 'logs',
  invocation: LaunchOptions,
): Promise<never> {
  switch (action) {
    case 'start':
      return runDaemonStart(invocation)
    case 'stop':
      return runDaemonStop()
    case 'restart':
      return runDaemonRestart(invocation)
    case 'status':
      return runDaemonStatus()
    case 'logs':
      return runDaemonLogs(invocation)
  }
}

// --- Top-level status (ADR-0015 §5) ---

async function runStatus(): Promise<never> {
  const probe = await daemonProbe()
  if (!probe.running) {
    console.log(`\n  ${CLI_NAME} — daemon not running`)
    console.log(`  Start one with: ${CLI_NAME} daemon start [path]\n`)
    process.exit(0)
  }
  console.log(`\n  ${CLI_NAME} — daemon running (pid ${probe.pid})`)
  if (!probe.state) {
    console.log('  state file missing — port unknown; stop and restart to re-record it\n')
    process.exit(0)
  }
  const baseUrl = baseUrlForState(probe.state)
  try {
    const status = await fetch(`${baseUrl}/api/status`).then((response) => response.json())
    console.log(`  serving:    ${status.root}`)
    console.log(`  uptime:     ${status.uptimeSeconds}s (since ${status.startedAt})`)
    console.log(`  listening:  ${status.host}:${status.port}`)
    console.log(`\n  Discovery`)
    console.log(`    app:        ${baseUrl}/`)
    console.log(`    docs:       ${baseUrl}/api/docs`)
    console.log(`    openapi:    ${baseUrl}/api/openapi.json`)
    console.log(`    discovery:  ${baseUrl}/api`)
    console.log(`    status:     ${baseUrl}/api/status\n`)
  } catch {
    console.log(`  process exists but is not responding at ${baseUrl}\n`)
  }
  process.exit(0)
}

function printHelp(): void {
  console.log(`${CLI_NAME} — local git commit-graph viewer, browse your repositories' history

Usage
  ${CLI_NAME} [path]                 Serve a directory (default: current) and open the browser
  ${CLI_NAME} serve [path]           Same as above, explicit
  ${CLI_NAME} daemon start [path]    Run a background server (idempotent — restarts if running)
  ${CLI_NAME} daemon stop            Stop the background server
  ${CLI_NAME} daemon restart         Restart the background server
  ${CLI_NAME} daemon status          Is the daemon alive and responding?
  ${CLI_NAME} daemon logs [N]        Tail the last N daemon log lines (default 200)
  ${CLI_NAME} status                 Full operational view + discovery links
  ${CLI_NAME} version                Print version
  ${CLI_NAME} help                   This help

Options (serve / daemon start)
  -p, --port <n>     Bind this exact port (strict — fails loudly if taken).
                     Omit to auto-assign a free port so instances never collide.
      --host <h>     Bind address (default ${DEFAULT_HOST}).
      --no-open      Do not open the browser (serve only).

The served root is scanned for git repositories (the root itself plus its direct
children). It binds loopback only. See the security model in README.md.`)
}

async function main(): Promise<void> {
  const parsed = parseCli(Bun.argv.slice(2), {
    host: process.env.HOST || DEFAULT_HOST,
  })
  if (!parsed.ok) {
    console.error(`${CLI_NAME}: ${parsed.error}`)
    process.exit(1)
  }

  const { intent } = parsed
  switch (intent.kind) {
    case 'help':
      printHelp()
      process.exit(0)
    case 'version':
      console.log(`${CLI_NAME} ${CLI_VERSION}`)
      process.exit(0)
    case 'status':
      return void (await runStatus())
    case 'daemon':
      return void (await runDaemon(intent.action, intent.options))
    case 'serve':
      return void (await runServe(intent.options))
  }
}

main()
