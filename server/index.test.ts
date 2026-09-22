import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The DNS-rebinding guard (issue #5) and the checkout's Origin check, end to end
// on the real server: `server/index.ts` is launched as its own process against a
// scratch repository, the way `bgg` launches it, so what is pinned here is the
// wiring the server actually ships — the guard mounted in front of discovery,
// the docs, every git read, and the checkout write.
//
// Requests go over a raw TCP socket, not `fetch`: the test DOM (happy-dom,
// preloaded for the component tests) replaces `fetch`/`Request` and drops the
// browser-forbidden `Host`, `Origin`, and `Sec-*` headers this test is about,
// and even a native client always sends a Host. A raw socket sends exactly the
// bytes a test names — including no Host at all.

const ALLOWED_HOST = 'graph.example.com'
const gitEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

let scratchRoot: string
let repositoryPath: string
let serverProcess: ReturnType<typeof Bun.spawn>
let port: number

function git(...gitArguments: string[]): string {
  const result = Bun.spawnSync(
    ['git', '-C', repositoryPath, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...gitArguments],
    { env: gitEnvironment },
  )
  if (result.exitCode !== 0) throw new Error(`git ${gitArguments.join(' ')} failed: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

/** Where HEAD is: the full hash and the checked-out branch ref (empty when detached). */
function headState() {
  const branch = Bun.spawnSync(['git', '-C', repositoryPath, 'symbolic-ref', '-q', 'HEAD'], { env: gitEnvironment })
  return { hash: git('rev-parse', 'HEAD'), branch: branch.stdout.toString().trim() }
}

beforeAll(async () => {
  scratchRoot = mkdtempSync(join(tmpdir(), 'git-graph-host-guard-'))
  repositoryPath = join(scratchRoot, 'victim')
  Bun.spawnSync(['git', 'init', '-q', '-b', 'main', repositoryPath], { env: gitEnvironment })
  git('commit', '--allow-empty', '-m', 'tagged')
  git('tag', '-a', '-m', 'v1', 'v1')
  git('commit', '--allow-empty', '-m', 'tip')

  // `auto` from a high canonical port, the bound port read back through the
  // ready-file handshake the CLI uses — no fixed port to collide with.
  const readyFilePath = join(scratchRoot, 'ready')
  serverProcess = Bun.spawn(['bun', join(import.meta.dir, 'index.ts'), scratchRoot], {
    env: {
      ...gitEnvironment,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(40000 + Math.floor(Math.random() * 10000)),
      GIT_GRAPH_PORT_STRATEGY: 'auto',
      GIT_GRAPH_READY_FILE: readyFilePath,
      GIT_GRAPH_ALLOWED_HOSTS: ALLOWED_HOST,
    },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  // The file can exist a moment before its content lands; wait for a port.
  const readPort = () => (existsSync(readyFilePath) ? Number(readFileSync(readyFilePath, 'utf8').trim()) : 0)
  for (let attempt = 0; attempt < 400 && !(readPort() > 0); attempt += 1) await Bun.sleep(25)
  port = readPort()
  if (!(port > 0)) throw new Error('the server never reported a bound port')
})

afterAll(async () => {
  serverProcess?.kill()
  await serverProcess?.exited
  rmSync(scratchRoot, { recursive: true, force: true })
})

/**
 * Send raw request bytes; resolve with the status code and body once the whole
 * response has arrived. The server keeps the socket open whatever the request's
 * `Connection` says, so completeness is read off the response itself: the
 * declared `Content-Length`, or a chunked body's terminating chunk.
 */
async function sendRaw(requestText: string): Promise<{ status: number; body: string }> {
  let responseText = ''
  const decoder = new TextDecoder()
  const { promise: complete, resolve: onComplete } = Promise.withResolvers<void>()
  const isComplete = () => {
    const headerEnd = responseText.indexOf('\r\n\r\n')
    if (headerEnd === -1) return false
    const head = responseText.slice(0, headerEnd).toLowerCase()
    const body = responseText.slice(headerEnd + 4)
    const contentLength = /\r\ncontent-length: *(\d+)/.exec(head)?.[1]
    if (contentLength !== undefined) return Buffer.byteLength(body) >= Number(contentLength)
    return /\r\ntransfer-encoding: *chunked/.test(head) ? body.endsWith('0\r\n\r\n') : false
  }
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data: (_socket, data) => {
        responseText += decoder.decode(data, { stream: true })
        if (isComplete()) onComplete()
      },
      close: () => onComplete(),
      error: () => onComplete(),
    },
  })
  socket.write(requestText)
  await complete
  socket.end()
  const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(responseText)?.[1] ?? 0)
  return { status, body: responseText.slice(responseText.indexOf('\r\n\r\n') + 4) }
}

const headerLines = (headers: Record<string, string>) =>
  Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('')

const get = (path: string, headers: Record<string, string>) =>
  sendRaw(`GET ${path} HTTP/1.1\r\n${headerLines({ ...headers, Connection: 'close' })}\r\n`)

const postCheckout = (headers: Record<string, string>, body: string) =>
  sendRaw(
    `POST /api/git/checkout HTTP/1.1\r\n` +
      headerLines({
        ...headers,
        'X-Git-Graph-Action': '1',
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
        Connection: 'close',
      }) +
      `\r\n${body}`,
  )

const tagCheckout = '{"repo":"victim","target":{"kind":"tag","name":"v1"}}'

describe('the Host guard on the running server', () => {
  test('serves loopback names, with and without a port, and the names GIT_GRAPH_ALLOWED_HOSTS lists', async () => {
    for (const host of ['localhost', `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, ALLOWED_HOST]) {
      const response = await get('/api/git/repos', { Host: host })
      expect(response.status).toBe(200)
      expect(response.body).toContain('"victim"')
    }
    // The docs page is a fixed Response — the kind Elysia would serve natively,
    // past the guard, were native static responses on. It must still answer here.
    expect((await get('/api/docs', { Host: `localhost:${port}` })).status).toBe(200)
  })

  test('refuses a foreign Host on every surface with 421 and no repository data', async () => {
    for (const path of ['/api', '/api/health', '/api/docs', '/api/openapi.json', '/api/git/repos', '/api/git/log?repo=victim']) {
      const response = await get(path, { Host: `rebind.attacker.test:${port}`, 'Sec-Fetch-Site': 'same-origin' })
      expect(response.status).toBe(421)
      expect(response.body).not.toContain('victim')
    }
  })

  test('refuses a request with no Host header with 400 — HTTP/1.0 and HTTP/1.1 alike', async () => {
    for (const version of ['HTTP/1.0', 'HTTP/1.1']) {
      const response = await sendRaw(`GET /api/git/repos ${version}\r\nConnection: close\r\n\r\n`)
      expect(response.status).toBe(400)
      expect(response.body).not.toContain('victim')
    }
  })

  // NST11963 finding 1, as the audit reproduced it: a DNS-rebound page's
  // checkout — the attacker's name in Host, and every header the checkout's
  // cross-origin gate asks for, since the browser honestly calls it same-origin.
  // Before the guard this answered 200 and detached HEAD at v1.
  test('refuses the rebound checkout with HEAD untouched', async () => {
    const before = headState()
    const response = await postCheckout(
      {
        Host: `rebind.attacker.test:${port}`,
        Origin: `http://rebind.attacker.test:${port}`,
        'Sec-Fetch-Site': 'same-origin',
      },
      tagCheckout,
    )
    expect(response.status).toBe(421)
    expect(headState()).toEqual(before)
    expect(before.branch).toBe('refs/heads/main')
  })

  test('the discovery document names the validated host, never a forwarded one it does not serve', async () => {
    const response = await get('/api', { Host: `localhost:${port}`, 'X-Forwarded-Host': 'evil.example' })
    expect(response.status).toBe(200)
    expect(response.body).not.toContain('evil.example')
    expect(JSON.parse(response.body).docs).toBe(`http://localhost:${port}/api/docs`)
  })
})

describe("the checkout's Origin check on the running server", () => {
  // NST11963 finding 3: a loopback Host and no Sec-Fetch-Site used to admit a
  // foreign Origin. The Origin is checked against the same allowlist now.
  test('refuses a foreign Origin that sends no Sec-Fetch-Site, with HEAD untouched', async () => {
    const before = headState()
    const response = await postCheckout({ Host: `127.0.0.1:${port}`, Origin: 'http://evil.example' }, tagCheckout)
    expect(response.status).toBe(403)
    expect(headState()).toEqual(before)
  })

  // Last, because it moves HEAD: the git-graph page itself still checks out.
  test('admits the git-graph page itself — a loopback Host and Origin, marked same-origin', async () => {
    const response = await postCheckout(
      { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, 'Sec-Fetch-Site': 'same-origin' },
      tagCheckout,
    )
    expect(response.status).toBe(200)
    expect(headState()).toEqual({ hash: git('rev-parse', 'v1^{commit}'), branch: '' })
  })
})
