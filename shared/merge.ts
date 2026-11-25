// The `git merge` argument shapes for "Merge <branch> into <checked-out branch>"
// — the second write the service performs. Sibling of `checkout.ts`: argument
// shapes live here; process spawning, the membership guards and the pre-merge
// checks live in the service.

/**
 * Config for every merge. `advice.diverging=false` drops git's multi-line hint
 * from a refused fast-forward, so the refusal the client shows is git's one
 * `fatal:` line.
 */
const MERGE_CONFIG_ARGUMENTS = ['-c', 'advice.diverging=false'] as const

/** What the service has already resolved and validated a merge into. */
export type ResolvedMerge = {
  /** The local branch to merge, exactly as `for-each-ref refs/heads` listed it. */
  branch: string
  /** True for a fast-forward and only a fast-forward; false for a `--no-ff` merge commit. */
  fastForward: boolean
}

/**
 * The argument list that performs a resolved merge. `--no-ff` creates a merge
 * commit even when a fast-forward would be possible; `--ff-only` moves the
 * branch forward or refuses. `--no-edit` takes git's default merge message and
 * never opens an editor, so the request never waits on one. The branch goes
 * after `--end-of-options`, so it can never read as an option, and as the short
 * name the listing gave, so git's default message reads `Merge branch 'x'`
 * rather than naming the full refname.
 */
export function mergeArguments(merge: ResolvedMerge): string[] {
  return [
    ...MERGE_CONFIG_ARGUMENTS,
    'merge',
    merge.fastForward ? '--ff-only' : '--no-ff',
    '--no-edit',
    '--end-of-options',
    merge.branch,
  ]
}

/** Undoes a merge that stopped on a conflict: HEAD, the index and the tree go back to before it. */
export const MERGE_ABORT_ARGUMENTS = ['merge', '--abort'] as const

/**
 * The tracked paths that differ from HEAD, staged or not — what blocks a merge.
 * Untracked files are not listed: they do not block, and if a merge would
 * overwrite one, git refuses on its own.
 */
export const TRACKED_CHANGES_ARGUMENTS = ['diff', '--no-ext-diff', '--name-only', '-z', 'HEAD', '--'] as const

/** How many uncommitted paths a refusal names before it summarises the rest. */
const NAMED_PATH_LIMIT = 5

/** The uncommitted paths a refusal names: the first few, then how many more. */
export function describeUncommittedPaths(paths: readonly string[]): string {
  const named = paths.slice(0, NAMED_PATH_LIMIT).join(', ')
  const remaining = paths.length - NAMED_PATH_LIMIT
  return remaining > 0 ? `${named} and ${remaining} more` : named
}

/** Why uncommitted tracked changes block a merge into `into` — one wording for the server and the dialog. */
export function uncommittedChangesReason(into: string, paths: readonly string[]): string {
  const count = `${paths.length} tracked file${paths.length === 1 ? '' : 's'}`
  return `${into} has uncommitted changes to ${count} (${describeUncommittedPaths(paths)}) — commit or stash them before merging`
}

/**
 * git's one-line report of a successful merge, from its stdout: the first line,
 * plus the `Fast-forward` line that follows `Updating a..b` on a fast-forward.
 */
export function mergeReport(stdout: string): string {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const [first = '', second] = lines
  return second === 'Fast-forward' ? `${first}, Fast-forward` : first
}
