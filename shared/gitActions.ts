import type { CheckoutTarget, GitCommit } from './git.schema'
import { classifyRefDecoration, refGroupLabel, type RefGroup } from './refGroup'

// The git-action context menu, as data. Which entries a commit row or a ref pill
// offers, and which of them cannot apply right now and why, is pure logic over
// the commit, its grouped refs, and where HEAD is — and every surface that opens
// the menu (this app's graph, and nightshift-ui's panel that embeds it) needs the
// identical answer. So it is the one descriptor here (ADR-0026), and the
// component that renders it (`GitActionMenu`) only adds icons, handlers, and
// keyboard behaviour.
//
// An entry that cannot apply is never dropped (ADR-0025): it carries the reason
// as `unavailableReason`, and the menu shows it disabled with that reason as its
// title.

export type GitActionId =
  | 'checkout-commit'
  | 'copy-commit-hash'
  | 'copy-short-hash'
  | 'open-commit'
  | 'checkout-branch'
  | 'compare-branch'
  | 'checkout-tag'

/** Where HEAD is, as far as the loaded history can say. */
export type HeadState = {
  /** Abbreviated hash of the commit HEAD points at; null when it is not in the loaded window. */
  hash: string | null
  /** The checked-out branch, or null when HEAD is detached (or not found). */
  branch: string | null
}

/**
 * Find HEAD in a commit log from its own decorations: `HEAD -> x` is HEAD on the
 * branch `x`, a bare `HEAD` is HEAD detached at that commit. `remoteNames` is
 * required for the reason `classifyRefDecoration` gives — the classifier must
 * never guess at a remote.
 */
export function findHeadState(commits: readonly GitCommit[], remoteNames: readonly string[]): HeadState {
  for (const commit of commits) {
    for (const decoration of commit.refs) {
      const classified = classifyRefDecoration(decoration, remoteNames)
      if (classified?.kind === 'head') return { hash: commit.hash, branch: null }
      if (classified?.kind === 'branch' && classified.isHead) return { hash: commit.hash, branch: classified.name }
    }
  }
  return { hash: null, branch: null }
}

export type GitMenuEntry = {
  action: GitActionId
  /** The entry's text in the menu. */
  label: string
  /**
   * The ref or commit the entry acts on — a branch or tag name for ref entries,
   * the abbreviated hash for commit entries.
   */
  subject: string
  /** Why this entry cannot apply in the current state, or null when it can. */
  unavailableReason: string | null
  /** True when running the entry changes the repository — the host must confirm first. */
  mutates: boolean
}

export type GitMenuSection = {
  /** What the section's entries act on, e.g. `branch main` or `commit abc1234`. */
  heading: string
  entries: GitMenuEntry[]
}

export type GitMenuInput = {
  commit: GitCommit
  /** The commit's refs, grouped — `groupRefDecorations(commit.refs, remotes)`. */
  refGroups: readonly RefGroup[]
  /**
   * The pill the menu was opened on, or null for the row. A pill's own entries
   * lead; a row lists the commit first and then every ref on it, which is also
   * what makes branch and tag checkout reachable from the keyboard.
   */
  focusedGroup: RefGroup | null
  head: HeadState
  /** The repository default branch — the base a compare uses; null when unknown. */
  defaultBranch: string | null
}

/** True when HEAD is detached at exactly this commit — a detach there changes nothing. */
const isDetachedHere = (head: HeadState, commit: GitCommit) =>
  head.branch === null && head.hash !== null && head.hash === commit.hash

function commitSection({ commit, head }: GitMenuInput): GitMenuSection {
  const detachedHere = isDetachedHere(head, commit)
  return {
    heading: `commit ${commit.hash}`,
    entries: [
      {
        action: 'checkout-commit',
        label: 'Checkout commit (detached HEAD)',
        subject: commit.hash,
        unavailableReason: detachedHere ? `HEAD is already detached at ${commit.hash}` : null,
        mutates: true,
      },
      {
        action: 'copy-commit-hash',
        label: 'Copy commit hash',
        subject: commit.hash,
        unavailableReason:
          commit.fullHash === '' ? 'the full hash of this commit was not loaded — copy the short hash instead' : null,
        mutates: false,
      },
      {
        action: 'copy-short-hash',
        label: 'Copy short hash',
        subject: commit.hash,
        unavailableReason: null,
        mutates: false,
      },
      {
        action: 'open-commit',
        label: 'Open commit in a new tab',
        subject: commit.hash,
        unavailableReason: null,
        mutates: false,
      },
    ],
  }
}

function refSection(group: RefGroup, input: GitMenuInput): GitMenuSection | null {
  const { head, defaultBranch, commit } = input
  switch (group.kind) {
    // A detached HEAD's own pill has nothing of its own to offer: the commit
    // section already acts on the commit it sits on.
    case 'head':
      return null
    case 'tag':
      return {
        heading: `tag ${group.name}`,
        entries: [
          {
            action: 'checkout-tag',
            label: 'Checkout tag (detached HEAD)',
            subject: group.name,
            unavailableReason: isDetachedHere(head, commit) ? `HEAD is already detached at ${commit.hash}` : null,
            mutates: true,
          },
        ],
      }
    case 'remote': {
      const qualifiedName = refGroupLabel(group).text
      return {
        heading: `remote branch ${qualifiedName}`,
        entries: [
          {
            action: 'checkout-branch',
            label: 'Checkout branch',
            subject: group.name,
            unavailableReason: `${qualifiedName} has no local branch — checking out a remote branch is not supported yet`,
            mutates: true,
          },
          {
            action: 'compare-branch',
            label: 'Compare against the default branch',
            subject: group.name,
            unavailableReason: `only local branches can be compared, and ${qualifiedName} has no local branch`,
            mutates: false,
          },
        ],
      }
    }
    case 'branch':
      return {
        heading: `branch ${group.name}`,
        entries: [
          {
            action: 'checkout-branch',
            label: 'Checkout branch',
            subject: group.name,
            unavailableReason: head.branch === group.name ? `${group.name} is already checked out` : null,
            mutates: true,
          },
          {
            action: 'compare-branch',
            label: 'Compare against the default branch',
            subject: group.name,
            unavailableReason:
              defaultBranch === null
                ? 'no default branch is known for this repository'
                : defaultBranch === group.name
                  ? `${group.name} is the default branch — comparing it against itself shows nothing`
                  : null,
            mutates: false,
          },
        ],
      }
  }
}

/**
 * The menu for a commit row or one of its ref pills, as sections of entries.
 * Opened on a pill, that ref's section leads and the commit's follows; opened on
 * the row, the commit's leads and every ref on the commit follows.
 */
export function buildGitMenuSections(input: GitMenuInput): GitMenuSection[] {
  const refSections = (groups: readonly RefGroup[]) =>
    groups.map((group) => refSection(group, input)).filter((section) => section !== null)
  if (input.focusedGroup !== null) {
    return [...refSections([input.focusedGroup]), commitSection(input)]
  }
  return [commitSection(input), ...refSections(input.refGroups)]
}

/** The checkout request a mutating menu entry stands for, or null for the others. */
export function checkoutTargetForEntry(entry: GitMenuEntry, commit: GitCommit): CheckoutTarget | null {
  switch (entry.action) {
    case 'checkout-branch':
      return { kind: 'branch', name: entry.subject }
    case 'checkout-tag':
      return { kind: 'tag', name: entry.subject }
    // The full hash when the log carried one: an abbreviation that is unique
    // today can become ambiguous as history grows.
    case 'checkout-commit':
      return { kind: 'commit', hash: commit.fullHash || commit.hash }
    default:
      return null
  }
}

/** What a confirmation step says before a mutating action runs. */
export type GitActionDescription = {
  title: string
  /** What will happen, to which repository, spelled as the git command it runs. */
  summary: string
  /** Consequences the user must see before confirming; empty when there are none. */
  warnings: string[]
  confirmLabel: string
}

/**
 * The statement a host shows before a checkout runs — what it will do, to which
 * repository — so that "states what it will do before it runs" has one wording
 * on every surface. A detaching checkout always carries the detached-HEAD
 * warning; uncommitted changes add git's own rule about them.
 */
export function describeCheckout(
  target: CheckoutTarget,
  { repositoryName, hasUncommittedChanges }: { repositoryName: string; hasUncommittedChanges: boolean },
): GitActionDescription {
  const warnings: string[] = []
  let title: string
  let summary: string
  if (target.kind === 'branch') {
    title = `Check out branch ${target.name}?`
    summary = `Runs git switch ${target.name} in ${repositoryName}: HEAD moves to the branch ${target.name} and the working tree is updated to its tip.`
  } else {
    const shownTarget = target.kind === 'tag' ? `tag ${target.name}` : `commit ${target.hash.slice(0, 12)}`
    const revision = target.kind === 'tag' ? target.name : target.hash.slice(0, 12)
    title = `Check out ${shownTarget}?`
    summary = `Runs git switch --detach ${revision} in ${repositoryName}: the working tree is updated to ${shownTarget}.`
    warnings.push(
      'This detaches HEAD: afterwards no branch is checked out, and commits made there belong to no branch ' +
        'until you create one — switching away leaves them unreachable.',
    )
  }
  if (hasUncommittedChanges) {
    warnings.push(
      `${repositoryName} has uncommitted changes. git carries them over to the new checkout, and refuses the ` +
        'checkout if any of them would be overwritten.',
    )
  }
  return { title, summary, warnings, confirmLabel: target.kind === 'branch' ? 'Check out branch' : 'Check out and detach' }
}
