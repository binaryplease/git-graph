import { describe, expect, test } from 'bun:test'
import { DetailLayoutSchema } from './detailLayout'

// The persisted-state contract (ADR-0029): a missing or garbage stored value
// falls back to the default rather than throwing, so old/absent localStorage
// still parses. Inline is the default layout.

describe('DetailLayoutSchema', () => {
  test('an absent stored value resolves to the inline default', () => {
    expect(DetailLayoutSchema.parse(undefined)).toBe('inline')
  })

  test('a garbage stored value falls back to the default rather than throwing', () => {
    expect(DetailLayoutSchema.parse('does-not-exist')).toBe('inline')
  })

  test('a valid stored value is preserved', () => {
    expect(DetailLayoutSchema.parse('sidebar')).toBe('sidebar')
    expect(DetailLayoutSchema.parse('inline')).toBe('inline')
  })
})
