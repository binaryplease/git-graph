import { describe, expect, test } from 'bun:test'
import {
  CANONICAL_CLIENT_PORT,
  CANONICAL_SERVER_PORT,
  describeDevPorts,
  devPortEnvironment,
  type DevPorts,
} from './dev-ports'

function assignment(requestedPort: number, assignedPort: number) {
  return { requestedPort, assignedPort, wasReassigned: assignedPort !== requestedPort }
}

describe('devPortEnvironment — pins resolved ports strictly', () => {
  test('pins server + client + a coherent proxy target, strategy strict', () => {
    const devPorts: DevPorts = {
      host: '127.0.0.1',
      server: assignment(CANONICAL_SERVER_PORT, CANONICAL_SERVER_PORT),
      client: assignment(CANONICAL_CLIENT_PORT, CANONICAL_CLIENT_PORT),
    }
    expect(devPortEnvironment(devPorts)).toEqual({
      HOST: '127.0.0.1',
      PORT: String(CANONICAL_SERVER_PORT),
      GIT_GRAPH_PORT_STRATEGY: 'strict',
      VITE_PORT: String(CANONICAL_CLIENT_PORT),
      VITE_API_TARGET: `http://127.0.0.1:${CANONICAL_SERVER_PORT}`,
    })
  })

  test('the proxy target follows a reassigned server port', () => {
    const devPorts: DevPorts = {
      host: '127.0.0.1',
      server: assignment(CANONICAL_SERVER_PORT, CANONICAL_SERVER_PORT + 1),
      client: assignment(CANONICAL_CLIENT_PORT, CANONICAL_CLIENT_PORT),
    }
    const environment = devPortEnvironment(devPorts)
    expect(environment.PORT).toBe(String(CANONICAL_SERVER_PORT + 1))
    expect(environment.VITE_API_TARGET).toBe(`http://127.0.0.1:${CANONICAL_SERVER_PORT + 1}`)
  })
})

describe('describeDevPorts — announces every reassignment (never silent)', () => {
  test('clean session names both ports without a note', () => {
    const devPorts: DevPorts = {
      host: '127.0.0.1',
      server: assignment(CANONICAL_SERVER_PORT, CANONICAL_SERVER_PORT),
      client: assignment(CANONICAL_CLIENT_PORT, CANONICAL_CLIENT_PORT),
    }
    const summary = describeDevPorts(devPorts)
    expect(summary).toContain(`server: ${CANONICAL_SERVER_PORT}`)
    expect(summary).toContain(`client: ${CANONICAL_CLIENT_PORT}`)
    expect(summary).not.toContain('reassigned')
  })

  test('a taken canonical port is called out with the cause', () => {
    const devPorts: DevPorts = {
      host: '127.0.0.1',
      server: assignment(CANONICAL_SERVER_PORT, CANONICAL_SERVER_PORT + 2),
      client: assignment(CANONICAL_CLIENT_PORT, CANONICAL_CLIENT_PORT),
    }
    const summary = describeDevPorts(devPorts)
    expect(summary).toContain(`port ${CANONICAL_SERVER_PORT} is in use — reassigned`)
    expect(summary).toContain('Another dev server is probably still')
  })
})
