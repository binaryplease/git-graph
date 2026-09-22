import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { RepositorySummary } from '../../shared/git.schema'

// Which repositories this server serves — the membership every request's
// repository identifier is re-validated against before anything reaches git.
// Its own module (ADR-0032): it depends on the filesystem and the operator's
// configuration, not on git, and would work unchanged if the git service were
// deleted. The git service composes one of the two sets below.
//
//   - The served root (`GIT_GRAPH_ROOT`, the default): the root itself when it
//     is a repository plus its direct children. The identifier is the path
//     relative to the root (`''` for the root itself).
//   - A repositories file (`GIT_GRAPH_REPOSITORIES_FILE`): exactly the absolute
//     paths the file names, one per line, wherever they live. This is how a
//     supervising host (nightshift-ui) has the server serve the repositories it
//     knows by absolute path, including ones outside any common root. The
//     identifier is the absolute path as the file names it (normalised).
//
// Either way a request can only name a member; it never widens the set. The file
// is re-read on every lookup, so a host can grow or shrink the set without a
// restart — and whoever can write that file decides what the server serves, just
// as whoever sets the environment does. A file that goes missing or malformed at
// runtime serves nothing (the lookup fails) rather than a guessed subset.

/** A listed repository: its public summary plus where it is on disk. */
export type ServedRepository = RepositorySummary & { absolutePath: string }

export type ServedRepositoryListing = {
  /** The scanned root, or null when the set is an explicit list. */
  rootPath: string | null
  repositories: ServedRepository[]
}

export type RepositorySet = {
  /** One line for the startup banner and `/api/status`: what is being served. */
  description: string
  list(): Promise<ServedRepositoryListing>
}

// A `.git` entry marks a repository — a directory for normal clones, a file
// for worktrees and submodules. Both render fine, so both count.
export const isGitRepository = (directoryPath: string) => existsSync(join(directoryPath, '.git'))

const byNameThenIdentifier = (first: ServedRepository, second: ServedRepository) =>
  first.name.localeCompare(second.name) || first.relativePath.localeCompare(second.relativePath)

/** The served root: the root itself (if it is a repository) plus its direct children. */
export function createServedRootRepositorySet(rootAbsolutePath: string): RepositorySet {
  const servedRoot = resolve(rootAbsolutePath)
  if (!existsSync(servedRoot)) {
    throw new Error(`git-graph root does not exist: ${servedRoot}`)
  }
  return {
    description: servedRoot,
    async list() {
      const repositories: ServedRepository[] = []
      if (isGitRepository(servedRoot)) {
        repositories.push({ name: basename(servedRoot), relativePath: '', absolutePath: servedRoot })
      }
      const entries = await readdir(servedRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const absolutePath = join(servedRoot, entry.name)
        if (isGitRepository(absolutePath)) {
          repositories.push({ name: entry.name, relativePath: entry.name, absolutePath })
        }
      }
      repositories.sort(byNameThenIdentifier)
      return { rootPath: servedRoot, repositories }
    },
  }
}

export type RepositoriesFileParse = { ok: true; paths: string[] } | { ok: false; reason: string }

/**
 * Parse a repositories file: one absolute path per line; blank lines and lines
 * starting with `#` are ignored. Every path must be absolute — a relative one
 * would resolve against whatever the server's working directory happens to be —
 * and a single bad line refuses the whole file rather than serving the rest.
 * Paths are normalised (`resolve`: no trailing slash, no `.`/`..` segments) and
 * de-duplicated; the normalised form is the identifier requests must send.
 */
export function parseRepositoriesFile(text: string): RepositoriesFileParse {
  const paths: string[] = []
  const lines = text.split('\n')
  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    if (!isAbsolute(line)) {
      return { ok: false, reason: `line ${lineIndex + 1} is not an absolute path: ${JSON.stringify(line)}` }
    }
    const normalisedPath = resolve(line)
    if (!paths.includes(normalisedPath)) paths.push(normalisedPath)
  }
  return { ok: true, paths }
}

function readRepositoriesFile(filePath: string): string[] {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(`git-graph repositories file cannot be read: ${filePath} (${(error as Error).message})`)
  }
  const parsed = parseRepositoriesFile(text)
  if (!parsed.ok) throw new Error(`git-graph repositories file ${filePath}: ${parsed.reason}`)
  return parsed.paths
}

/**
 * Exactly the repositories a file names. Read once here so a missing or malformed
 * file crashes the boot, then re-read on every listing. A named path that is not
 * (or no longer) a git repository is left out of the listing, the way the root
 * scan leaves out a directory that is not one — a host can name its projects
 * without first checking which of them are repositories.
 */
export function createListedRepositorySet(repositoriesFilePath: string): RepositorySet {
  const filePath = resolve(repositoriesFilePath)
  readRepositoriesFile(filePath)
  return {
    description: `the repositories listed in ${filePath}`,
    async list() {
      const repositories = readRepositoriesFile(filePath)
        .filter(isGitRepository)
        .map((absolutePath) => ({ name: basename(absolutePath) || absolutePath, relativePath: absolutePath, absolutePath }))
      repositories.sort(byNameThenIdentifier)
      return { rootPath: null, repositories }
    },
  }
}
