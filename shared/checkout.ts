// The `git switch` argument shapes for a checkout — the first write the service
// performs. Sibling of `compareDiff.ts` and `workingTree.ts`: argument shapes
// live here, process spawning and the membership guards live in the service.
//
// `git switch` rather than `git checkout`: checkout overloads "move HEAD" with
// "restore these paths", so a name that happens to match a file can turn a
// branch switch into overwriting that file from the index. switch only ever
// moves HEAD.

/**
 * Config for every checkout. `advice.detachedHead=false` trims git's multi-line
 * "You are in 'detached HEAD' state…" lecture down to the one `HEAD is now at`
 * line, which is what the client shows as git's report — the client states the
 * detached-HEAD consequence itself, before the checkout runs.
 */
const CHECKOUT_CONFIG_ARGUMENTS = ['-c', 'advice.detachedHead=false'] as const

/** What the service has already resolved and validated a checkout target into. */
export type ResolvedCheckout =
  /** A local branch name, exactly as `for-each-ref refs/heads` listed it. */
  | { kind: 'branch'; name: string }
  /**
   * A revision to detach HEAD at — a full `refs/tags/…` refname or a full commit
   * hash, never a short name git would have to disambiguate.
   */
  | { kind: 'detach'; revision: string }

/**
 * The argument list that performs a resolved checkout. A branch name goes after
 * `--` so it can never read as an option, and `--no-guess` stops git from
 * quietly creating a tracking branch when the name only exists on a remote — the
 * membership guard has already said it is local. A detach target is a full
 * refname or a full hash, so it has exactly one reading.
 */
export function checkoutArguments(checkout: ResolvedCheckout): string[] {
  if (checkout.kind === 'branch') {
    return [...CHECKOUT_CONFIG_ARGUMENTS, 'switch', '--no-guess', '--', checkout.name]
  }
  return [...CHECKOUT_CONFIG_ARGUMENTS, 'switch', '--detach', checkout.revision]
}
