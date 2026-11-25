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
  /**
   * The full hash `refs/heads/<branch>` pointed at when the checks ran. The
   * merge names this hash, never the short branch name: git resolves a short
   * name through `.git/<name>`, `refs/<name>` and `refs/tags/<name>` before
   * `refs/heads/<name>`, so a same-named tag (one a plain fetch can bring in), a
   * branch called `FETCH_HEAD`, or one called `remotes/origin/x` would merge a
   * different commit than the one the checks and the dialog described.
   */
  commitHash: string
  /** True for a fast-forward and only a fast-forward; false for a `--no-ff` merge commit. */
  fastForward: boolean
  /**
   * git's default message for merging the branch, from {@link mergeMessageInput}
   * through `git fmt-merge-msg` — what `git merge <branch>` would have written.
   * Unused by a fast-forward, which creates no commit.
   */
  message: string
}

/**
 * The argument list that performs a resolved merge. `--no-ff` creates a merge
 * commit even when a fast-forward would be possible; `--ff-only` moves the
 * branch forward or refuses. The message is passed with `-m` and `--no-edit`
 * keeps the editor closed, so the request never waits on one. The commit goes
 * after `--end-of-options`, so it can never read as an option.
 */
export function mergeArguments(merge: ResolvedMerge): string[] {
  return [
    ...MERGE_CONFIG_ARGUMENTS,
    'merge',
    ...(merge.fastForward ? ['--ff-only'] : ['--no-ff', '-m', merge.message]),
    '--no-edit',
    '--end-of-options',
    merge.commitHash,
  ]
}

/** Builds git's default merge message from {@link mergeMessageInput} on stdin. */
export const MERGE_MESSAGE_ARGUMENTS = ['fmt-merge-msg'] as const

/**
 * The line `git merge <branch>` itself hands `git fmt-merge-msg` for a local
 * branch, so the message for the hash names the branch exactly as git's default
 * would (`Merge branch 'x'`, `Merge branch 'x' into y`), with the operator's
 * `merge.log` / `merge.suppressDest` settings applied by git.
 */
export const mergeMessageInput = (commitHash: string, branch: string) => `${commitHash}\t\tbranch '${branch}' of .\n`

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
