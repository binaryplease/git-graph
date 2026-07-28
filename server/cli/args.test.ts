import { describe, expect, test } from 'bun:test'
import { parseCli, type CliIntent } from './args'

const ENVIRONMENT = { host: '127.0.0.1' }

/** Narrow a successful parse to its intent, failing the test otherwise. */
function intentOf(argumentList: string[], environment = ENVIRONMENT): CliIntent {
  const result = parseCli(argumentList, environment)
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`)
  return result.intent
}

describe('parseCli — command routing', () => {
  test('no arguments is a serve of the current directory', () => {
    const intent = intentOf([])
    expect(intent.kind).toBe('serve')
    if (intent.kind === 'serve') expect(intent.options.positionals).toEqual([])
  })

  test('a bare path is a serve of that path', () => {
    const intent = intentOf(['~/projects'])
    expect(intent.kind).toBe('serve')
    if (intent.kind === 'serve') expect(intent.options.positionals).toEqual(['~/projects'])
  })

  test('explicit serve carries its path', () => {
    const intent = intentOf(['serve', '~/projects'])
    expect(intent.kind).toBe('serve')
    if (intent.kind === 'serve') expect(intent.options.positionals).toEqual(['~/projects'])
  })

  test('help and version aliases', () => {
    for (const alias of ['help', '--help', '-h']) expect(intentOf([alias]).kind).toBe('help')
    for (const alias of ['version', '--version', '-v']) expect(intentOf([alias]).kind).toBe('version')
  })

  test('status is its own top-level command', () => {
    expect(intentOf(['status']).kind).toBe('status')
  })
})

describe('parseCli — daemon actions', () => {
  test('start / stop / status / logs map through', () => {
    for (const action of ['start', 'stop', 'status', 'logs'] as const) {
      const intent = intentOf(['daemon', action])
      expect(intent.kind).toBe('daemon')
      if (intent.kind === 'daemon') expect(intent.action).toBe(action)
    }
  })

  test('reload is a synonym for restart', () => {
    const intent = intentOf(['daemon', 'reload'])
    if (intent.kind !== 'daemon') throw new Error('expected daemon')
    expect(intent.action).toBe('restart')
  })

  test('daemon start passes its path and flags', () => {
    const intent = intentOf(['daemon', 'start', '/srv', '--port', '4000'])
    if (intent.kind !== 'daemon') throw new Error('expected daemon')
    expect(intent.action).toBe('start')
    expect(intent.options.positionals).toEqual(['/srv'])
    expect(intent.options.explicitPort).toBe(4000)
  })

  test('a missing or unknown daemon action is an error', () => {
    expect(parseCli(['daemon'], ENVIRONMENT).ok).toBe(false)
    expect(parseCli(['daemon', 'frobnicate'], ENVIRONMENT).ok).toBe(false)
  })
})

describe('parseCli — flags', () => {
  test('--port accepts both spellings', () => {
    const spaced = intentOf(['serve', '--port', '8080'])
    const equals = intentOf(['serve', '--port=8080'])
    if (spaced.kind !== 'serve' || equals.kind !== 'serve') throw new Error('expected serve')
    expect(spaced.options.explicitPort).toBe(8080)
    expect(equals.options.explicitPort).toBe(8080)
  })

  test('absent --port leaves the port to be auto-assigned', () => {
    const intent = intentOf(['serve'])
    if (intent.kind !== 'serve') throw new Error('expected serve')
    expect(intent.options.explicitPort).toBeUndefined()
  })

  test.each(['0', '70000', 'abc', '-5'])('rejects out-of-range/invalid --port %p', (value) => {
    expect(parseCli(['serve', '--port', value], ENVIRONMENT).ok).toBe(false)
  })

  test('--host overrides the environment default', () => {
    const intent = intentOf(['serve', '--host', '0.0.0.0'])
    if (intent.kind !== 'serve') throw new Error('expected serve')
    expect(intent.options.host).toBe('0.0.0.0')
  })

  test('--no-open disables opening the browser; default opens', () => {
    const opens = intentOf(['serve'])
    const quiet = intentOf(['serve', '--no-open'])
    if (opens.kind !== 'serve' || quiet.kind !== 'serve') throw new Error('expected serve')
    expect(opens.options.open).toBe(true)
    expect(quiet.options.open).toBe(false)
  })

  test('an unknown flag is an error', () => {
    expect(parseCli(['serve', '--frobnicate'], ENVIRONMENT).ok).toBe(false)
  })

  test('--host without a value is an error', () => {
    expect(parseCli(['serve', '--host'], ENVIRONMENT).ok).toBe(false)
  })
})
