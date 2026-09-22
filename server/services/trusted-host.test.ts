import { describe, expect, test } from 'bun:test'
import { evaluateRequestHost, hostnameFromHostHeader, isTrustedHostname, isTrustedOrigin } from './trusted-host'

// The DNS-rebinding guard (issue #5). A rebound request is indistinguishable
// from a legitimate one except for the name in its Host header, so the name
// parsing and the allowlist are pinned on their own here; the composition on a
// real server is routes/trusted-host.test.ts.

describe('hostnameFromHostHeader', () => {
  test('strips the port', () => {
    expect(hostnameFromHostHeader('localhost:3010')).toBe('localhost')
    expect(hostnameFromHostHeader('127.0.0.1:3010')).toBe('127.0.0.1')
    expect(hostnameFromHostHeader('graph.example.com')).toBe('graph.example.com')
  })

  test('keeps a bracketed IPv6 literal whole instead of splitting it at its first colon', () => {
    expect(hostnameFromHostHeader('[::1]:3010')).toBe('[::1]')
    expect(hostnameFromHostHeader('[::1]')).toBe('[::1]')
  })

  test('normalises case and surrounding whitespace', () => {
    expect(hostnameFromHostHeader('  LocalHost:3010 ')).toBe('localhost')
  })

  test('refuses anything that is not a bare authority rather than trimming it into one', () => {
    for (const hostHeader of [
      '',
      'localhost:3010/path',
      'evil.example@localhost',
      'localhost evil.example',
      'localhost, evil.example',
      '::1:3010',
      '[::1',
      'localhost:',
      'localhost:abc',
      'localhost:123456',
    ]) {
      expect(hostnameFromHostHeader(hostHeader)).toBeNull()
    }
  })
})

describe('isTrustedHostname', () => {
  test('serves the loopback names by default: localhost, the 127.0.0.0/8 block, and [::1]', () => {
    for (const hostname of ['localhost', '127.0.0.1', '127.0.0.53', '[::1]']) {
      expect(isTrustedHostname(hostname, [])).toBe(true)
    }
  })

  test('refuses every other name by default, including ones an attacker can point at 127.0.0.1', () => {
    for (const hostname of ['evil.example', 'evil.localhost', 'localhost.', 'localhost.evil.example', '0.0.0.0', '127.1']) {
      expect(isTrustedHostname(hostname, [])).toBe(false)
    }
  })

  test('serves exactly the names GIT_GRAPH_ALLOWED_HOSTS lists, however an entry is written', () => {
    const allowed = [' Graph.Example.com ', 'other.example:8443', 'fe80::1']
    expect(isTrustedHostname('graph.example.com', allowed)).toBe(true)
    expect(isTrustedHostname('other.example', allowed)).toBe(true)
    expect(isTrustedHostname('[fe80::1]', allowed)).toBe(true)
    expect(isTrustedHostname('sub.graph.example.com', allowed)).toBe(false)
    expect(isTrustedHostname('example.com', allowed)).toBe(false)
  })
})

describe('evaluateRequestHost', () => {
  test('admits loopback and allowed hosts, with or without a port, and hands back the authority', () => {
    for (const hostHeader of ['localhost', 'localhost:3010', '127.0.0.1:3010', '[::1]', '[::1]:3010']) {
      expect(evaluateRequestHost(hostHeader, [])).toEqual({ ok: true, authority: hostHeader })
    }
    expect(evaluateRequestHost('graph.example.com', ['graph.example.com']).ok).toBe(true)
  })

  test('refuses a foreign name with 421 — the Host a DNS-rebound page carries', () => {
    const verdict = evaluateRequestHost('rebind.attacker.test:3010', [])
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.statusCode).toBe(421)
      expect(verdict.reason).toContain('rebind.attacker.test')
    }
    expect(evaluateRequestHost('rebind.attacker.test', ['graph.example.com']).ok).toBe(false)
  })

  test('refuses a request with no Host header, or an empty one, with 400', () => {
    for (const hostHeader of [null, '', '   ']) {
      const verdict = evaluateRequestHost(hostHeader, [])
      expect(verdict).toMatchObject({ ok: false, statusCode: 400 })
    }
  })

  test('refuses a malformed Host with 400 even when it contains a loopback name', () => {
    expect(evaluateRequestHost('localhost@evil.example', [])).toMatchObject({ ok: false, statusCode: 400 })
    expect(evaluateRequestHost('localhost/x', [])).toMatchObject({ ok: false, statusCode: 400 })
  })
})

describe('isTrustedOrigin', () => {
  test('trusts an http(s) origin whose host the server answers for, on any port', () => {
    expect(isTrustedOrigin('http://localhost:5183', [])).toBe(true)
    expect(isTrustedOrigin('http://[::1]:3010', [])).toBe(true)
    expect(isTrustedOrigin('https://graph.example.com', ['graph.example.com'])).toBe(true)
  })

  test('refuses a foreign host, an opaque origin, a non-http scheme, and garbage', () => {
    for (const origin of ['http://evil.example', 'null', 'file:///tmp/x.html', 'ftp://localhost', 'localhost']) {
      expect(isTrustedOrigin(origin, [])).toBe(false)
    }
  })
})
