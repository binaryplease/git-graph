import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function gitIn(repository: string, ...gitArguments: string[]): string {
  const result = Bun.spawnSync(
    ['git', '-C', repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...gitArguments],
    { env: gitEnvironment },
  )
  if (result.exitCode !== 0) throw new Error(`git ${gitArguments.join(' ')} failed: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

const git = (...gitArguments: string[]) => gitIn(repositoryPath, ...gitArguments)

/** A repository with `main` one commit past the annotated tag `v1`. */
function createTaggedRepository(path: string) {
  Bun.spawnSync(['git', 'init', '-q', '-b', 'main', path], { env: gitEnvironment })
  gitIn(path, 'commit', '--allow-empty', '-m', 'tagged')
  gitIn(path, 'tag', '-a', '-m', 'v1', 'v1')
  gitIn(path, 'commit', '--allow-empty', '-m', 'tip')
}

/** Where HEAD is: the full hash and the checked-out branch ref (empty when detached). */
function headStateOf(repository: string) {
  const branch = Bun.spawnSync(['git', '-C', repository, 'symbolic-ref', '-q', 'HEAD'], { env: gitEnvironment })
  return { hash: gitIn(repository, 'rev-parse', 'HEAD'), branch: branch.stdout.toString().trim() }
}

const headState = () => headStateOf(repositoryPath)

/**
 * Launch the real server as its own process, `auto` from a high canonical port,
 * the bound port read back through the ready-file handshake the CLI uses — no
 * fixed port to collide with.
 */
async function launchServer(options: { root: string; scratch: string; environment: Record<string, string> }) {
  const readyFilePath = join(options.scratch, 'ready')
  const launched = Bun.spawn(['bun', join(import.meta.dir, 'index.ts'), options.root], {
    env: {
      ...gitEnvironment,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(40000 + Math.floor(Math.random() * 10000)),
      GIT_GRAPH_PORT_STRATEGY: 'auto',
      GIT_GRAPH_READY_FILE: readyFilePath,
      ...options.environment,
    },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  // The file can exist a moment before its content lands; wait for a port.
  const readPort = () => (existsSync(readyFilePath) ? Number(readFileSync(readyFilePath, 'utf8').trim()) : 0)
  for (let attempt = 0; attempt < 400 && !(readPort() > 0); attempt += 1) await Bun.sleep(25)
  const boundPort = readPort()
  if (!(boundPort > 0)) throw new Error('the server never reported a bound port')
  return { process: launched, port: boundPort }
}

beforeAll(async () => {
  scratchRoot = mkdtempSync(join(tmpdir(), 'git-graph-host-guard-'))
  repositoryPath = join(scratchRoot, 'victim')
  createTaggedRepository(repositoryPath)
  const launched = await launchServer({
    root: scratchRoot,
    scratch: scratchRoot,
    environment: { GIT_GRAPH_ALLOWED_HOSTS: ALLOWED_HOST },
  })
  serverProcess = launched.process
  port = launched.port
})

afterAll(async () => {
  serverProcess?.kill()
  await serverProcess?.exited
  rmSync(scratchRoot, { recursive: true, force: true })
})

type RawResponse = { status: number; headers: Record<string, string>; body: string }

/**
 * Send raw request bytes; resolve with the status code, headers (lower-cased
 * names), and body once the whole response has arrived. The server keeps the
 * socket open whatever the request's `Connection` says, so completeness is read
 * off the response itself: the declared `Content-Length`, or a chunked body's
 * terminating chunk.
 */
async function sendRawTo(targetPort: number, requestText: string): Promise<RawResponse> {
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
    port: targetPort,
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
  const headerEnd = responseText.indexOf('\r\n\r\n')
  const headers: Record<string, string> = {}
  for (const line of responseText.slice(0, headerEnd).split('\r\n').slice(1)) {
    const separator = line.indexOf(':')
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
  }
  return { status, headers, body: responseText.slice(headerEnd + 4) }
}

const sendRaw = (requestText: string) => sendRawTo(port, requestText)

const headerLines = (headers: Record<string, string>) =>
  Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('')

const getFrom = (targetPort: number, path: string, headers: Record<string, string>) =>
  sendRawTo(targetPort, `GET ${path} HTTP/1.1\r\n${headerLines({ ...headers, Connection: 'close' })}\r\n`)

const get = (path: string, headers: Record<string, string>) => getFrom(port, path, headers)

/** A CORS preflight for the checkout, as a browser sends it before the POST. */
const preflightCheckoutTo = (targetPort: number, headers: Record<string, string>) =>
  sendRawTo(
    targetPort,
    `OPTIONS /api/git/checkout HTTP/1.1\r\n` +
      headerLines({
        ...headers,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-git-graph-action',
        Connection: 'close',
      }) +
      '\r\n',
  )

const postCheckoutTo = (targetPort: number, headers: Record<string, string>, body: string) =>
  sendRawTo(
    targetPort,
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

const postCheckout = (headers: Record<string, string>, body: string) => postCheckoutTo(port, headers, body)

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

describe('a server with no embedding origins configured', () => {
  // The default posture: another loopback page — the very origin an embedding
  // host would have — gets no CORS grant and no checkout.
  test('grants no CORS and refuses a same-site checkout from another loopback origin, HEAD untouched', async () => {
    const hostOrigin = 'http://127.0.0.1:3115'
    const read = await get('/api/git/repos', { Host: `127.0.0.1:${port}`, Origin: hostOrigin })
    expect(read.headers['access-control-allow-origin']).toBeUndefined()
    const preflight = await preflightCheckoutTo(port, { Host: `127.0.0.1:${port}`, Origin: hostOrigin })
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    expect(preflight.headers['access-control-allow-headers']).toBeUndefined()

    const before = headState()
    const response = await postCheckout(
      { Host: `127.0.0.1:${port}`, Origin: hostOrigin, 'Sec-Fetch-Site': 'same-site' },
      tagCheckout,
    )
    expect(response.status).toBe(403)
    expect(headState()).toEqual(before)
  })
})

// The embedding-host configuration end to end: the server launched the way a
// supervising host (nightshift-ui) launches it — a repositories file naming
// repositories by absolute path, one of them outside any common root, and the
// host page's exact origins in GIT_GRAPH_ALLOWED_ORIGINS.
describe('the embedding-host configuration on the running server', () => {
  const HOST_ORIGIN = 'http://127.0.0.1:3115'
  const OTHER_HOST_ORIGIN = 'http://localhost:5175'
  let embedScratch: string
  let embedProcess: ReturnType<typeof Bun.spawn>
  let embedPort: number
  let repositoriesFile: string
  // `hosted` sits in the directory also passed as the root; `run` lives
  // elsewhere entirely (a cache-directory checkout); `unlisted` sits beside
  // `hosted` in that root but is not named by the file.
  let hostedPath: string
  let runPath: string
  let unlistedPath: string

  beforeAll(async () => {
    embedScratch = mkdtempSync(join(tmpdir(), 'git-graph-embedding-'))
    hostedPath = join(embedScratch, 'projects', 'hosted')
    runPath = join(embedScratch, 'cache', 'runs', 'run-1')
    unlistedPath = join(embedScratch, 'projects', 'unlisted')
    for (const path of [hostedPath, runPath, unlistedPath]) createTaggedRepository(path)
    repositoriesFile = join(embedScratch, 'repositories')
    writeFileSync(repositoriesFile, `${hostedPath}\n${runPath}\n`)

    const launched = await launchServer({
      // The root the CLI would pass anyway; the repositories file replaces it.
      root: join(embedScratch, 'projects'),
      scratch: embedScratch,
      environment: {
        GIT_GRAPH_REPOSITORIES_FILE: repositoriesFile,
        GIT_GRAPH_ALLOWED_ORIGINS: `${HOST_ORIGIN},${OTHER_HOST_ORIGIN}`,
      },
    })
    embedProcess = launched.process
    embedPort = launched.port
  })

  afterAll(async () => {
    embedProcess?.kill()
    await embedProcess?.exited
    rmSync(embedScratch, { recursive: true, force: true })
  })

  const hostRequest = (origin = HOST_ORIGIN) => ({ Host: `127.0.0.1:${embedPort}`, Origin: origin })
  const checkoutBody = (repository: string) => JSON.stringify({ repo: repository, target: { kind: 'tag', name: 'v1' } })

  test('lists exactly the named repositories by absolute path, readable by the host origin', async () => {
    const response = await getFrom(embedPort, '/api/git/repos', hostRequest())
    expect(response.status).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe(HOST_ORIGIN)
    expect(response.headers.vary).toContain('Origin')
    expect(JSON.parse(response.body)).toEqual({
      rootPath: null,
      repositories: [
        { name: 'hosted', relativePath: hostedPath },
        { name: 'run-1', relativePath: runPath },
      ],
    })
  })

  test('each configured origin reads a repository outside any common root; the grant names that origin only', async () => {
    for (const origin of [HOST_ORIGIN, OTHER_HOST_ORIGIN]) {
      const response = await getFrom(embedPort, `/api/git/log?repo=${encodeURIComponent(runPath)}`, hostRequest(origin))
      expect(response.status).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBe(origin)
      expect(JSON.parse(response.body).repository).toBe('run-1')
    }
  })

  test('answers the host origin’s checkout preflight — and nobody else’s', async () => {
    const granted = await preflightCheckoutTo(embedPort, hostRequest())
    expect(granted.status).toBe(204)
    expect(granted.headers['access-control-allow-origin']).toBe(HOST_ORIGIN)
    expect(granted.headers['access-control-allow-methods']).toContain('POST')
    expect(granted.headers['access-control-allow-headers']).toContain('x-git-graph-action')
    expect(granted.headers['access-control-allow-credentials']).toBeUndefined()

    for (const origin of ['http://127.0.0.1:3999', 'http://localhost:3115', 'https://evil.example']) {
      const refused = await preflightCheckoutTo(embedPort, hostRequest(origin))
      expect(refused.headers['access-control-allow-origin']).toBeUndefined()
      expect(refused.headers['access-control-allow-headers']).toBeUndefined()
    }
  })

  test('an unconfigured origin gets no CORS grant on a read, so its browser withholds the response', async () => {
    for (const origin of ['http://127.0.0.1:3999', 'https://evil.example']) {
      const response = await getFrom(embedPort, '/api/git/repos', hostRequest(origin))
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    }
  })

  test('refuses a repository outside the configured set — to the host origin too, readably', async () => {
    for (const identifier of [unlistedPath, 'unlisted', 'hosted', '', `${hostedPath}/../unlisted`]) {
      const response = await getFrom(embedPort, `/api/git/log?repo=${encodeURIComponent(identifier)}`, hostRequest())
      expect(response.status).toBe(404)
      expect(response.headers['access-control-allow-origin']).toBe(HOST_ORIGIN)
    }
    const before = headStateOf(unlistedPath)
    const response = await postCheckoutTo(
      embedPort,
      { ...hostRequest(), 'Sec-Fetch-Site': 'same-site' },
      checkoutBody(unlistedPath),
    )
    expect(response.status).toBe(404)
    expect(headStateOf(unlistedPath)).toEqual(before)
  })

  test('refuses a checkout from an unconfigured origin, same-site or cross-site, with HEAD untouched', async () => {
    const before = headStateOf(hostedPath)
    for (const [origin, fetchSite] of [
      ['http://127.0.0.1:3999', 'same-site'],
      ['http://localhost:3115', 'same-site'],
      ['https://evil.example', 'cross-site'],
    ] as const) {
      const response = await postCheckoutTo(
        embedPort,
        { ...hostRequest(origin), 'Sec-Fetch-Site': fetchSite },
        checkoutBody(hostedPath),
      )
      expect(response.status).toBe(403)
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    }
    expect(headStateOf(hostedPath)).toEqual(before)
  })

  test('refuses a foreign Host even alongside a configured Origin — the rebinding defence is untouched', async () => {
    const before = headStateOf(hostedPath)
    const foreign = { Host: `rebind.attacker.test:${embedPort}`, Origin: HOST_ORIGIN }
    const read = await getFrom(embedPort, '/api/git/repos', foreign)
    expect(read.status).toBe(421)
    expect(read.headers['access-control-allow-origin']).toBeUndefined()
    expect(read.body).not.toContain('hosted')
    const write = await postCheckoutTo(embedPort, { ...foreign, 'Sec-Fetch-Site': 'same-site' }, checkoutBody(hostedPath))
    expect(write.status).toBe(421)
    expect(headStateOf(hostedPath)).toEqual(before)
  })

  test('follows the repositories file as the host rewrites it, without a restart', async () => {
    const listed = async () =>
      JSON.parse((await getFrom(embedPort, '/api/git/repos', hostRequest())).body).repositories.map(
        (repository: { name: string }) => repository.name,
      )
    writeFileSync(repositoriesFile, `${hostedPath}\n${runPath}\n${unlistedPath}\n`)
    expect(await listed()).toEqual(['hosted', 'run-1', 'unlisted'])
    writeFileSync(repositoriesFile, `${hostedPath}\n${runPath}\n`)
    expect(await listed()).toEqual(['hosted', 'run-1'])
    const response = await getFrom(embedPort, `/api/git/log?repo=${encodeURIComponent(unlistedPath)}`, hostRequest())
    expect(response.status).toBe(404)
  })

  test('reports what it serves and for whom in /api/status', async () => {
    const response = await getFrom(embedPort, '/api/status', { Host: `localhost:${embedPort}` })
    const status = JSON.parse(response.body)
    expect(status.root).toBeNull()
    expect(status.repositoriesFile).toBe(repositoriesFile)
    expect(status.allowedOrigins).toEqual([HOST_ORIGIN, OTHER_HOST_ORIGIN])
  })

  // Last, because it moves HEAD: the host page's own checkout, as its browser
  // sends it across origins.
  test('checks out for the configured host origin, and the host can read the result', async () => {
    const response = await postCheckoutTo(
      embedPort,
      { ...hostRequest(), 'Sec-Fetch-Site': 'same-site' },
      checkoutBody(runPath),
    )
    expect(response.status).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe(HOST_ORIGIN)
    expect(JSON.parse(response.body).repository).toBe('run-1')
    expect(headStateOf(runPath)).toEqual({ hash: gitIn(runPath, 'rev-parse', 'v1^{commit}'), branch: '' })
  })
})

describe('embedding configuration that cannot be honoured fails the boot', () => {
  const bootFailure = async (environment: Record<string, string>) => {
    const scratch = mkdtempSync(join(tmpdir(), 'git-graph-bad-boot-'))
    try {
      const launched = Bun.spawn(['bun', join(import.meta.dir, 'index.ts'), scratch], {
        // Never reaches the bind; the port only has to parse.
        env: { ...gitEnvironment, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '40000', ...environment },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stderr] = await Promise.all([launched.exited, new Response(launched.stderr).text()])
      return { exitCode, stderr }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }

  test('an origin written other than a browser sends it', async () => {
    const { exitCode, stderr } = await bootFailure({ GIT_GRAPH_ALLOWED_ORIGINS: 'http://127.0.0.1:3115/' })
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('GIT_GRAPH_ALLOWED_ORIGINS')
  })

  test('a repositories file that is missing or names a relative path', async () => {
    const missing = await bootFailure({ GIT_GRAPH_REPOSITORIES_FILE: '/no/such/repositories-file' })
    expect(missing.exitCode).not.toBe(0)
    expect(missing.stderr).toContain('cannot be read')

    const listDirectory = mkdtempSync(join(tmpdir(), 'git-graph-bad-list-'))
    try {
      const relativeList = join(listDirectory, 'repositories')
      writeFileSync(relativeList, 'Developer/project\n')
      const relative = await bootFailure({ GIT_GRAPH_REPOSITORIES_FILE: relativeList })
      expect(relative.exitCode).not.toBe(0)
      expect(relative.stderr).toContain('not an absolute path')
    } finally {
      rmSync(listDirectory, { recursive: true, force: true })
    }
  })
})
