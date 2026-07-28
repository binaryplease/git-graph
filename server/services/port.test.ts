import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, test } from 'bun:test'
import { findAvailablePort, isPortAvailable } from './port'

const TEST_HOST = '127.0.0.1'
const occupiedServers: Server[] = []

/** Bind `port` for the duration of a test so the probe sees it as taken. */
function occupyPort(port: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const blockingServer = createServer()
    blockingServer.once('error', rejectPromise)
    blockingServer.once('listening', () => {
      occupiedServers.push(blockingServer)
      resolvePromise()
    })
    blockingServer.listen({ port, host: TEST_HOST, exclusive: true })
  })
}

afterEach(async () => {
  await Promise.all(
    occupiedServers.splice(0).map((server) => new Promise((done) => server.close(done))),
  )
})

describe('isPortAvailable', () => {
  test('reports a bound port as unavailable', async () => {
    await occupyPort(31500)
    expect(await isPortAvailable(31500, TEST_HOST)).toBe(false)
  })

  test('reports a free port as available', async () => {
    expect(await isPortAvailable(31501, TEST_HOST)).toBe(true)
  })
})

describe('findAvailablePort', () => {
  test('keeps the requested port when it is free', async () => {
    expect(await findAvailablePort(31510, TEST_HOST)).toBe(31510)
  })

  test('walks past occupied ports', async () => {
    await occupyPort(31520)
    await occupyPort(31521)
    expect(await findAvailablePort(31520, TEST_HOST)).toBe(31522)
  })

  test('skips ports already reserved for a sibling process', async () => {
    expect(await findAvailablePort(31530, TEST_HOST, new Set([31530, 31531]))).toBe(31532)
  })
})
