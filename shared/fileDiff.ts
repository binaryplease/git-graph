// The `git show` wire format for a single file's diff, and the small pure
// helpers around it. Sibling of `commitDetail.ts`: text in, data out, no
// process spawning and no DOM.
//
// Three git invocations make up one file diff — the patch itself, and the two
// complete blobs the patch applies between. The blobs are what lets the client
// syntax-highlight the whole file rather than each line in isolation.

/**
 * Patch for one file of one commit.
 *
 * `--no-ext-diff --no-textconv` are load-bearing: a user's global difftastic or
 * delta driver would otherwise replace the unified diff with a format no
 * parser understands. `-m --first-parent` matches the choice
 * {@link COMMIT_DETAIL_ARGUMENTS} already made, so a merge shows what it
 * brought in. `--format=` suppresses the commit header, leaving only the patch.
 */
export const FILE_DIFF_ARGUMENTS = [
  'show',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '-m',
  '--first-parent',
  '--format=',
] as const

/**
 * A file diff larger than this is reported as truncated instead of returned.
 * The client renders whole files, so a partial payload is not merely lossy —
 * it would highlight the wrong thing. Covers the patch and both blobs.
 */
export const MAX_FILE_DIFF_BYTES = 2_000_000

/**
 * Extension → the language identifier the client's highlighter understands.
 * The value set is the highlighter's own supported list; anything unmapped
 * falls back to `txt`, which renders unhighlighted rather than failing.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  bat: 'bat',
  c: 'c',
  cc: 'c++',
  cjs: 'javascript',
  cmake: 'cmake',
  cmd: 'cmd',
  cpp: 'c++',
  cs: 'c#',
  css: 'css',
  csv: 'csv',
  cts: 'typescript',
  cxx: 'c++',
  diff: 'diff',
  elm: 'elm',
  fish: 'fish',
  go: 'go',
  graphql: 'graphql',
  h: 'c',
  hpp: 'c++',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  json5: 'json5',
  jsonc: 'jsonc',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  md: 'markdown',
  markdown: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  nix: 'nix',
  patch: 'diff',
  php: 'php',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  typ: 'typst',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

/** Filenames that carry no extension but still have a well-known grammar. */
const LANGUAGE_BY_FILENAME: Record<string, string> = {
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
}

/**
 * Highlighter language for a repository-relative path, defaulting to `txt`.
 * Pure, so both ends of the seam can agree on it without a round trip.
 */
export function languageForPath(filePath: string): string {
  const fileName = (filePath.split('/').pop() ?? '').toLowerCase()
  const byFileName = LANGUAGE_BY_FILENAME[fileName]
  if (byFileName) return byFileName
  const extensionIndex = fileName.lastIndexOf('.')
  if (extensionIndex <= 0) return 'txt'
  return LANGUAGE_BY_EXTENSION[fileName.slice(extensionIndex + 1)] ?? 'txt'
}

/**
 * Split a multi-file patch into one string per file. `git show -- <path>`
 * already limits the patch to one file, so this normally yields a single
 * element; it exists because git emits one `diff --git` block per rename half
 * and per parent, and the diff viewer takes the list.
 */
export function splitPatchIntoFileHunks(patchText: string): string[] {
  const trimmed = patchText.trim()
  if (!trimmed) return []
  const hunks: string[] = []
  let current: string[] = []
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      hunks.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) hunks.push(current.join('\n'))
  return hunks
}
