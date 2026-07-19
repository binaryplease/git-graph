import { describe, expect, test } from 'bun:test'
import { fuzzyHighlight } from './fuzzy'

const highlightedText = (text: string, query: string) =>
  fuzzyHighlight(text, query)
    .segments.filter((segment) => segment.matched)
    .map((segment) => segment.text)
    .join('')

describe('fuzzyHighlight', () => {
  test('empty query matches everything without highlights', () => {
    expect(fuzzyHighlight('hello', '')).toEqual({
      matched: true,
      segments: [{ text: 'hello', matched: false }],
    })
    expect(fuzzyHighlight('', '')).toEqual({ matched: true, segments: [] })
  })

  test('matches characters as an in-order subsequence', () => {
    const result = fuzzyHighlight('feat: add the widget', 'fwid')
    expect(result.matched).toBe(true)
    expect(highlightedText('feat: add the widget', 'fwid')).toBe('fwid')
  })

  test('is case-insensitive but preserves original casing in segments', () => {
    const result = fuzzyHighlight('Merge Branch', 'mb')
    expect(result.matched).toBe(true)
    expect(highlightedText('Merge Branch', 'mb')).toBe('MB')
  })

  test('does not match out-of-order or missing characters', () => {
    expect(fuzzyHighlight('abc', 'ca').matched).toBe(false)
    expect(fuzzyHighlight('abc', 'abcd').matched).toBe(false)
  })

  test('segments reassemble to the original text', () => {
    const { segments } = fuzzyHighlight('refactor: extract helper', 'rex')
    expect(segments.map((segment) => segment.text).join('')).toBe('refactor: extract helper')
  })

  test('greedy left-to-right matching marks the earliest possible characters', () => {
    const { segments, matched } = fuzzyHighlight('aba', 'ab')
    expect(matched).toBe(true)
    expect(segments).toEqual([{ text: 'ab', matched: true }, { text: 'a', matched: false }])
  })
})
