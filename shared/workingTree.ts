// The `git diff` wire format for the working tree — the uncommitted changes in a
// repository, measured against HEAD — and the small constants around it. Sibling
// of `compareDiff.ts` and `fileDiff.ts`: argument shapes and named constants
// live here, process spawning lives in the service.
//
// "Uncommitted changes" is everything not yet in a commit: modifications and
// deletions to tracked files (staged or not — `git diff HEAD` folds the index
// and the worktree together), plus untracked files. The tracked half comes from
// a single `git diff HEAD`; the untracked half from `git ls-files --others`,
// since `git diff` never lists files git has not been told about.

/**
 * The well-known SHA-1 of git's empty tree. A repository with no commits has no
 * HEAD to diff against, so the working tree is measured against this instead —
 * every tracked file then reads as an addition, which is exactly what it is.
 */
export const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * `--raw` + `--numstat` file listing for the working tree, parsed by
 * `parseCommitFileChanges` — the same wire format `git show` and the branch
 * comparison already produce, so the same parser reads all three.
 */
export const WORKING_SUMMARY_ARGUMENTS = [
  'diff',
  '--no-color',
  '--raw',
  '--numstat',
  '--find-renames',
] as const

/**
 * The unified patch for one tracked file of the working tree. `--no-ext-diff
 * --no-textconv` are load-bearing exactly as in {@link FILE_DIFF_ARGUMENTS}: a
 * user's global difftastic or delta driver would otherwise replace the diff
 * with a format no parser understands.
 */
export const WORKING_FILE_DIFF_ARGUMENTS = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--find-renames',
] as const

/**
 * The unified patch for one untracked file. `--no-index` diffs two paths
 * outside git's index (here `/dev/null` against the new file), which is how an
 * untracked file — absent from every tree — still yields a full-addition patch.
 * `--no-ext-diff --no-textconv` stay load-bearing for the same reason as above.
 */
export const UNTRACKED_FILE_DIFF_ARGUMENTS = [
  'diff',
  '--no-index',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
] as const

/** `git diff --no-index` exits 1 when the two paths differ; only above that is it a real failure. */
export const NO_INDEX_DIFFERENCES_EXIT_CODE = 1

/** List untracked, non-ignored files, NUL-separated so paths with odd characters survive. */
export const LIST_UNTRACKED_ARGUMENTS = [
  'ls-files',
  '--others',
  '--exclude-standard',
  '-z',
] as const

/**
 * Whether a `--no-index` patch is git's binary marker rather than a line diff.
 * An untracked file's binary-ness is not known until it is diffed (unlike a
 * tracked file, whose `--numstat` reports `-` counts up front), and for a binary
 * one git emits a lone `Binary files … differ` line with no `@@` hunk. The
 * caller must not then read the file as text or hand the hunk-less patch to the
 * line-diff builder — it returns the binary notice instead, exactly as a binary
 * tracked file does.
 */
export function isBinaryNoIndexPatch(patchText: string): boolean {
  return /^Binary files .* differ$/m.test(patchText)
}
