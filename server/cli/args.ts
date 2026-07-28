/**
 * Pure command-line parsing for the CLI — argv in, a typed intent out, no I/O
 * and no `process.exit`. Keeping this separate from the effect-running entry
 * (server/cli.ts) is the ADR-0010 split: the routing and flag rules are a pure
 * function the orchestrator dispatches on, which is also what makes them
 * testable without spawning anything.
 */

export type DaemonAction = 'start' | 'stop' | 'restart' | 'status' | 'logs'

/** Flags shared by the serve and `daemon start` commands. */
export type LaunchOptions = {
  /** Positional arguments after the command — the first is the served root. */
  positionals: string[]
  /** An explicit --port (strict) or undefined to auto-assign a free one. */
  explicitPort: number | undefined
  /** Bind address. */
  host: string
  /** Whether to open the browser once serving (serve only). */
  open: boolean
}

export type CliIntent =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'status' }
  | { kind: 'serve'; options: LaunchOptions }
  | { kind: 'daemon'; action: DaemonAction; options: LaunchOptions }

export type ParseResult = { ok: true; intent: CliIntent } | { ok: false; error: string }

/** Defaults the parser reads from the environment, injected so it stays pure. */
export type ParseEnvironment = {
  host: string
}

const DAEMON_ACTIONS: Record<string, DaemonAction> = {
  start: 'start',
  stop: 'stop',
  restart: 'restart',
  reload: 'restart',
  status: 'status',
  logs: 'logs',
}

function parsePortValue(raw: string | undefined): number | 'invalid' {
  const port = Number(raw)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return 'invalid'
  return port
}

/** Split a command's argument tail into flags and positionals. */
function parseLaunchOptions(
  argumentList: string[],
  environment: ParseEnvironment,
): { ok: true; options: LaunchOptions } | { ok: false; error: string } {
  const positionals: string[] = []
  let explicitPort: number | undefined
  let host = environment.host
  let open = true

  for (let index = 0; index < argumentList.length; index++) {
    const argument = argumentList[index]
    if (argument === '--port' || argument === '-p') {
      const port = parsePortValue(argumentList[++index])
      if (port === 'invalid') return { ok: false, error: `--port needs an integer 1-65535` }
      explicitPort = port
    } else if (argument.startsWith('--port=')) {
      const port = parsePortValue(argument.slice('--port='.length))
      if (port === 'invalid') return { ok: false, error: `--port needs an integer 1-65535` }
      explicitPort = port
    } else if (argument === '--host') {
      const value = argumentList[++index]
      if (value === undefined) return { ok: false, error: '--host needs a value' }
      host = value
    } else if (argument.startsWith('--host=')) {
      host = argument.slice('--host='.length)
    } else if (argument === '--no-open') {
      open = false
    } else if (argument.startsWith('-') && argument !== '-') {
      return { ok: false, error: `unknown flag "${argument}"` }
    } else {
      positionals.push(argument)
    }
  }

  return { ok: true, options: { positionals, explicitPort, host, open } }
}

/**
 * Parse a full invocation (argv after the runtime + script) into a typed
 * intent. A bare path or no command is `serve` — the broot-style default.
 */
export function parseCli(argumentList: string[], environment: ParseEnvironment): ParseResult {
  const [command, ...rest] = argumentList

  if (command === 'help' || command === '--help' || command === '-h') return okIntent({ kind: 'help' })
  if (command === 'version' || command === '--version' || command === '-v') {
    return okIntent({ kind: 'version' })
  }
  if (command === 'status') return okIntent({ kind: 'status' })

  if (command === 'daemon') {
    const [rawAction, ...daemonRest] = rest
    const action = rawAction === undefined ? undefined : DAEMON_ACTIONS[rawAction]
    if (action === undefined) {
      return {
        ok: false,
        error: `unknown daemon action "${rawAction ?? ''}". Try: start | stop | restart | status | logs`,
      }
    }
    const parsed = parseLaunchOptions(daemonRest, environment)
    if (!parsed.ok) return parsed
    return okIntent({ kind: 'daemon', action, options: parsed.options })
  }

  // `serve [path]`, or no command / a bare path / bare flags → serve.
  const serveArguments = command === 'serve' ? rest : command === undefined ? [] : [command, ...rest]
  const parsed = parseLaunchOptions(serveArguments, environment)
  if (!parsed.ok) return parsed
  return okIntent({ kind: 'serve', options: parsed.options })
}

function okIntent(intent: CliIntent): ParseResult {
  return { ok: true, intent }
}
