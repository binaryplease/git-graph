// Subsequence fuzzy matching with matched-character highlighting (ADR-0019).
// Behaviour ported from the mission-control-center prototype: the query
// matches when all of its characters appear in order (case-insensitive,
// greedy left-to-right); every matched character is reported so the UI can
// highlight it.

export type FuzzySegment = {
  text: string
  matched: boolean
}

export type FuzzyHighlight = {
  /** True when every query character was found, in order. An empty query always matches. */
  matched: boolean
  /** The full text, split into runs of matched / unmatched characters. */
  segments: FuzzySegment[]
}

export function fuzzyHighlight(text: string, query: string): FuzzyHighlight {
  if (!query) return { matched: true, segments: text ? [{ text, matched: false }] : [] }

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let queryPosition = 0

  const segments: FuzzySegment[] = []
  const appendCharacter = (character: string, matched: boolean) => {
    const lastSegment = segments[segments.length - 1]
    if (lastSegment && lastSegment.matched === matched) {
      lastSegment.text += character
    } else {
      segments.push({ text: character, matched })
    }
  }

  for (let index = 0; index < text.length; index++) {
    if (queryPosition < lowerQuery.length && lowerText[index] === lowerQuery[queryPosition]) {
      appendCharacter(text[index]!, true)
      queryPosition++
    } else {
      appendCharacter(text[index]!, false)
    }
  }

  return { matched: queryPosition === lowerQuery.length, segments }
}
