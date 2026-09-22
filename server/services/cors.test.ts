import { describe, expect, test } from 'bun:test'
import { corsHeadersFor, isAllowedOrigin, parseAllowedOrigins } from './cors'

// The embedding seam's pure half. Matching is exact string equality against
// what a browser writes in `Origin`, so the parser refuses anything a browser
// would never send — an entry that can never match would admit nothing silently.

describe('parseAllowedOrigins', () => {
  test('empty means no embedding origins at all', () => {
    expect(parseAllowedOrigins('')).toEqual([])
    expect(parseAllowedOrigins(' , ')).toEqual([])
  })

  test('accepts serialised http(s) origins, trimmed and de-duplicated', () => {
    expect(
      parseAllowedOrigins(' http://127.0.0.1:3115, http://localhost:5175 ,https://ui.example.com,http://127.0.0.1:3115'),
    ).toEqual(['http://127.0.0.1:3115', 'http://localhost:5175', 'https://ui.example.com'])
    expect(parseAllowedOrigins('http://[::1]:3115')).toEqual(['http://[::1]:3115'])
  })

  test('refuses, by name, anything that is not exactly an origin', () => {
    for (const entry of [
      'http://127.0.0.1:3115/',
      'http://127.0.0.1:3115/app',
      '127.0.0.1:3115',
      'localhost',
      'file:///tmp',
      'null',
      '*',
      'http://LOCALHOST:3115',
      'http://localhost:80',
      'http://user@localhost:3115',
    ]) {
      expect(() => parseAllowedOrigins(entry)).toThrow(JSON.stringify(entry))
    }
  })
})

describe('corsHeadersFor', () => {
  const allowedOrigins = ['http://127.0.0.1:3115']

  test('reflects a listed Origin with the methods and headers the git routes use', () => {
    const headers = corsHeadersFor('http://127.0.0.1:3115', allowedOrigins)
    expect(headers['access-control-allow-origin']).toBe('http://127.0.0.1:3115')
    expect(headers.vary).toBe('Origin')
    expect(headers['access-control-allow-methods']).toBe('GET, POST')
    expect(headers['access-control-allow-headers']).toBe('content-type, x-git-graph-action')
    expect(headers['access-control-allow-credentials']).toBeUndefined()
  })

  test('grants nothing to an absent, unlisted, or merely similar Origin', () => {
    for (const origin of [null, 'http://127.0.0.1:3116', 'http://localhost:3115', 'http://127.0.0.1:3115/', 'null']) {
      expect(corsHeadersFor(origin, allowedOrigins)).toEqual({})
      expect(isAllowedOrigin(origin, allowedOrigins)).toBe(false)
    }
    expect(corsHeadersFor('http://127.0.0.1:3115', [])).toEqual({})
  })
})
