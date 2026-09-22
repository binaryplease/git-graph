import { describe, expect, test } from 'bun:test'
import { resolvePublicOrigin } from './public-origin'

// The ADR-0020 discovery document names an origin. Before issue #5 it reflected
// `x-forwarded-host` / `Host` unchecked, so any request could choose the host
// the docs, openapi, and health links point at.

const resolve = (overrides: Partial<Parameters<typeof resolvePublicOrigin>[0]> = {}) =>
  resolvePublicOrigin({
    requestUrl: 'http://127.0.0.1:3010/api',
    hostHeader: 'localhost:3010',
    forwardedProtocolHeader: null,
    forwardedHostHeader: null,
    additionalAllowedHosts: [],
    ...overrides,
  })

describe('resolvePublicOrigin', () => {
  test('names the validated Host when nothing is forwarded', () => {
    expect(resolve()).toBe('http://localhost:3010')
  })

  test('ignores a forwarded host the server does not answer for', () => {
    expect(resolve({ forwardedHostHeader: 'evil.example' })).toBe('http://localhost:3010')
    expect(resolve({ forwardedHostHeader: 'localhost@evil.example' })).toBe('http://localhost:3010')
  })

  test('honours a forwarded host that is loopback or allowed — the first entry of a list', () => {
    expect(resolve({ forwardedHostHeader: 'localhost:5183' })).toBe('http://localhost:5183')
    expect(
      resolve({
        forwardedHostHeader: 'graph.example.com, internal.proxy',
        forwardedProtocolHeader: 'https',
        additionalAllowedHosts: ['graph.example.com'],
      }),
    ).toBe('https://graph.example.com')
  })

  test('takes only http or https from x-forwarded-proto', () => {
    expect(resolve({ forwardedProtocolHeader: 'https' })).toBe('https://localhost:3010')
    expect(resolve({ forwardedProtocolHeader: 'javascript' })).toBe('http://localhost:3010')
  })
})
