import { getDiffViewHighlighter } from '@git-diff-view/shiki'

// The one syntax highlighter for the app (ADR-0026: one descriptor, one
// wrapper, one guard). It is a whole-file tokenizer, which is the point —
// highlighting a diff line in isolation loses the continuation state that tells
// a line inside a block comment from live code.
//
// ADR-0016: grammars and the WASM engine are bundled and code-split by the
// build, never fetched from a CDN at runtime.

// Warming these at app start moves the first grammar load — roughly half a
// second — off the first diff a user expands. They are the languages this
// codebase is mostly made of; everything else loads on demand below.
const WARM_LANGUAGES = ['typescript', 'tsx', 'javascript', 'json', 'css', 'markdown'] as const

let highlighterPromise: ReturnType<typeof getDiffViewHighlighter> | null = null

/**
 * The shared highlighter, started on first call and reused thereafter.
 *
 * `getDiffViewHighlighter` hands back a singleton and ignores the language list
 * on every call after the first, and a grammar it has not loaded yields no
 * tokens — silently, since the diff still builds. So a language is loaded here
 * through the engine before the caller builds with it. A grammar that does not
 * exist is not an error: the diff renders unhighlighted, which is what the
 * library does for `txt` anyway.
 */
export async function loadHighlighter(language?: string) {
  highlighterPromise ??= getDiffViewHighlighter([...WARM_LANGUAGES])
  const highlighter = await highlighterPromise
  if (language !== undefined && language !== 'txt') {
    try {
      const engine = await highlighter.getHighlighterEngine()
      await engine?.loadLanguage(language as Parameters<NonNullable<typeof engine>['loadLanguage']>[0])
    } catch {
      // No such grammar — render the diff without highlighting rather than
      // failing the expand.
    }
  }
  return highlighter
}
