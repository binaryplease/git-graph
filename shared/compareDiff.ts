// The `git diff` wire format for comparing two branches, and the small pure
// helper around it. Sibling of `fileDiff.ts` and `commitDetail.ts`: argument
// shapes and text logic live here, process spawning lives in the service.
//
// A branch comparison is a three-dot diff — `base...head` — which git resolves
// to merge-base(base, head) versus head. That is the "what does this branch add
// relative to main" view, the same one a pull request shows, rather than a raw
// endpoint-to-endpoint diff that also counts everything main gained since the
// branch diverged.

/** `--raw` + `--numstat` file listing for a comparison, parsed by `parseCommitFileChanges`. */
export const COMPARE_SUMMARY_ARGUMENTS = [
  'diff',
  '--no-color',
  '--raw',
  '--numstat',
  '--find-renames',
] as const

/**
 * The unified patch for one file of a comparison. `--no-ext-diff --no-textconv`
 * are load-bearing exactly as in {@link FILE_DIFF_ARGUMENTS}: a user's global
 * difftastic or delta driver would otherwise replace the diff with a format no
 * parser understands.
 */
export const COMPARE_FILE_DIFF_ARGUMENTS = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--find-renames',
] as const

/**
 * The revision argument that selects the comparison: `base...head` (merge-base
 * old side) when the branches share history, or the two endpoints directly when
 * they do not — `A...B` errors when there is no merge base, so an unrelated pair
 * falls back to a straight `A B` diff.
 */
export function compareRevisionArguments(base: string, head: string, hasMergeBase: boolean): string[] {
  return hasMergeBase ? [`${base}...${head}`] : [base, head]
}
