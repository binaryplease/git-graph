/**
 * Pre-dev port setup (ADR-0037 §2).
 *
 * ADR-0018 keeps port conflicts fatal *at bind time*: neither Elysia nor Vite
 * may migrate to another port behind the developer's back. This module runs
 * strictly *before* either process starts — it probes the canonical ports,
 * announces every conflict it finds, and picks explicit replacements that are
 * then pinned into both processes' environment. Nothing is silent, the two
 * ports stay coherent (Vite's `/api` proxy is retargeted with the server), and
 * the runtime bind remains strict: if the chosen port is stolen between the
 * probe and the bind, the server still dies loudly.
 */
import { findAvailablePort, isPortAvailable } from '../server/services/port'

// Re-exported so scripts/dev-ports.test.ts keeps exercising them through this
// module; the implementations live in the general port service (ADR-0032).
export { findAvailablePort, isPortAvailable }

// Canonical dev ports, offset from binp-file-explorer's 3000/5173 so both
// services run side by side (see AGENTS.md).
export const CANONICAL_SERVER_PORT = 3010
export const CANONICAL_CLIENT_PORT = 5183

export type DevPortAssignment = {
  /** The port the service is configured to want. */
  requestedPort: number
  /** The port it will actually be started on. */
  assignedPort: number
  /** True when the canonical port was taken and a replacement was chosen. */
  wasReassigned: boolean
}

export type DevPorts = {
  host: string
  server: DevPortAssignment
  client: DevPortAssignment
}

async function assignPort(
  requestedPort: number,
  host: string,
  reservedPorts: Set<number>,
): Promise<DevPortAssignment> {
  const assignedPort = await findAvailablePort(requestedPort, host, reservedPorts)
  reservedPorts.add(assignedPort)
  return { requestedPort, assignedPort, wasReassigned: assignedPort !== requestedPort }
}

/**
 * Resolve the pair of ports the dev session will use. The server is assigned
 * first so the client's `/api` proxy target is known before Vite starts.
 */
export async function resolveDevPorts(): Promise<DevPorts> {
  const host = process.env.HOST || '127.0.0.1'
  const requestedServerPort = Number(process.env.PORT) || CANONICAL_SERVER_PORT
  const requestedClientPort = Number(process.env.VITE_PORT) || CANONICAL_CLIENT_PORT
  const reservedPorts = new Set<number>()

  return {
    host,
    server: await assignPort(requestedServerPort, host, reservedPorts),
    client: await assignPort(requestedClientPort, host, reservedPorts),
  }
}

/** Environment overrides that pin the resolved ports into both dev processes. */
export function devPortEnvironment(devPorts: DevPorts): Record<string, string> {
  return {
    HOST: devPorts.host,
    PORT: String(devPorts.server.assignedPort),
    // A pinned dev port is an explicit choice — bind it strictly, no walk
    // (ADR-0037 §3: allocation already happened here, in front of the bind).
    GIT_GRAPH_PORT_STRATEGY: 'strict',
    VITE_PORT: String(devPorts.client.assignedPort),
    // vite.config.ts proxies /api here; it must follow a reassigned server.
    VITE_API_TARGET: `http://${devPorts.host}:${devPorts.server.assignedPort}`,
  }
}

function describeAssignment(label: string, assignment: DevPortAssignment): string {
  if (!assignment.wasReassigned) return `  ${label}: ${assignment.assignedPort}`
  return `  ${label}: ${assignment.assignedPort}  (port ${assignment.requestedPort} is in use — reassigned)`
}

/** Human-readable summary printed before the dev servers start. */
export function describeDevPorts(devPorts: DevPorts): string {
  const lines = [
    `Dev ports on ${devPorts.host}`,
    describeAssignment('server', devPorts.server),
    describeAssignment('client', devPorts.client),
  ]
  if (devPorts.server.wasReassigned || devPorts.client.wasReassigned) {
    lines.push(
      '  Note: a canonical port was taken. Another dev server is probably still',
      '  running — open http://' + `${devPorts.host}:${devPorts.client.assignedPort}` + ' for this session.',
    )
  }
  return lines.join('\n')
}

// `mise run dev:ports` / `bun scripts/dev-ports.ts` — probe and report only.
// `--env` prints KEY=value lines for shells that want to eval the result.
if (import.meta.main) {
  const devPorts = await resolveDevPorts()
  if (process.argv.includes('--env')) {
    for (const [name, value] of Object.entries(devPortEnvironment(devPorts))) {
      console.log(`${name}=${value}`)
    }
  } else {
    console.log(describeDevPorts(devPorts))
  }
}
