import { describe, expect, test } from 'bun:test'
import { listenWithStrategy } from './listen'

/** A fake Elysia-shaped app whose given ports are already taken. */
function fakeApp(occupiedPorts: number[]) {
  const occupied = new Set(occupiedPorts)
  const boundPorts: number[] = []
  return {
    boundPorts,
    listen(options: { port: number }) {
      if (occupied.has(options.port)) {
        throw Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' })
      }
      boundPorts.push(options.port)
      return undefined
    },
  }
}

const BASE = { host: '127.0.0.1', isDev: false } as const

describe('listenWithStrategy — strict', () => {
  test('binds the requested port exactly and returns it', () => {
    const app = fakeApp([])
    const port = listenWithStrategy(app, { ...BASE, requestedPort: 3010, strategy: 'strict' })
    expect(port).toBe(3010)
    expect(app.boundPorts).toEqual([3010])
  })

  test('propagates EADDRINUSE (fails loud, never walks)', () => {
    const app = fakeApp([3010])
    expect(() =>
      listenWithStrategy(app, { ...BASE, requestedPort: 3010, strategy: 'strict' }),
    ).toThrow('EADDRINUSE')
    expect(app.boundPorts).toEqual([])
  })
})

describe('listenWithStrategy — auto', () => {
  test('binds the requested port when free', () => {
    const app = fakeApp([])
    const port = listenWithStrategy(app, { ...BASE, requestedPort: 3010, strategy: 'auto' })
    expect(port).toBe(3010)
  })

  test('walks past occupied ports and announces each skip', () => {
    const app = fakeApp([3010, 3011, 3012])
    const skipped: number[] = []
    const port = listenWithStrategy(app, {
      ...BASE,
      requestedPort: 3010,
      strategy: 'auto',
      announce: (skippedPort) => skipped.push(skippedPort),
    })
    expect(port).toBe(3013)
    expect(app.boundPorts).toEqual([3013])
    expect(skipped).toEqual([3010, 3011, 3012])
  })

  test('throws when the whole search span is occupied', () => {
    const everyPort = Array.from({ length: 200 }, (_unused, index) => 3010 + index)
    const app = fakeApp(everyPort)
    expect(() =>
      listenWithStrategy(app, { ...BASE, requestedPort: 3010, strategy: 'auto' }),
    ).toThrow('No free port found')
  })

  test('a non-EADDRINUSE error is not swallowed by the walk', () => {
    const app = {
      listen() {
        throw new Error('boom')
      },
    }
    expect(() =>
      listenWithStrategy(app, { ...BASE, requestedPort: 3010, strategy: 'auto' }),
    ).toThrow('boom')
  })
})
