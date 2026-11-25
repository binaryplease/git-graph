import { useState } from 'react'
import type { MergePreview, MergeTarget } from '../../shared/git.schema'
import {
  describeMerge,
  fastForwardUnavailableReason,
  mergeBlockedReason,
  type GitActionFailure,
} from '../../shared/gitActions'
import { ConfirmActionDialog } from './ConfirmActionDialog'

// The confirmation for "Merge x into y" (issue #2). It is `ConfirmActionDialog`
// plus what only a merge has: the Fast Forward option, and a state read from
// git before anything runs (`MergePreview`) that can block the merge — the
// checked-out branch has uncommitted changes, already contains the branch, or is
// no longer the branch the menu named. Fetch-free like every component behind
// the barrel: the host fetches the preview, runs the merge on confirm, and hands
// back a failure as `describeMergeFailure` words it.
//
// The Fast Forward option starts unchecked — a `--no-ff` merge commit is the
// default — and is disabled with its reason when git's ancestry says a
// fast-forward is not possible (ADR-0025).

export type ConfirmMergeDialogProps = {
  /** The branch to merge and the checked-out branch it goes into, as the menu saw them. */
  target: MergeTarget
  repositoryName: string
  /** What git reports about the merge right now; null while the host is still reading it. */
  preview: MergePreview | null
  /** Why reading the preview failed, or null. */
  previewError: string | null
  /** True while the host is running the merge. */
  isRunning: boolean
  /** The last attempt's failure (`describeMergeFailure`), or null. */
  failure: GitActionFailure | null
  /** Run the merge — a fast-forward only when `fastForward` is true, a `--no-ff` merge commit otherwise. */
  onConfirm: (options: { fastForward: boolean }) => void
  onCancel: () => void
}

export function ConfirmMergeDialog({
  target,
  repositoryName,
  preview,
  previewError,
  isRunning,
  failure,
  onConfirm,
  onCancel,
}: ConfirmMergeDialogProps) {
  const [fastForwardChosen, setFastForwardChosen] = useState(false)

  const fastForwardReason =
    previewError !== null
      ? 'whether a fast-forward is possible could not be checked'
      : preview === null
        ? 'checking whether a fast-forward is possible…'
        : fastForwardUnavailableReason(target, preview)
  // An option that cannot apply is never left checked: what is confirmed is
  // always what the dialog states.
  const fastForward = fastForwardChosen && fastForwardReason === null

  const blockedReason =
    previewError !== null
      ? `the repository could not be checked before merging: ${previewError}`
      : preview === null
        ? 'checking the repository before merging…'
        : mergeBlockedReason(target, preview)

  return (
    <ConfirmActionDialog
      description={describeMerge(target, { repositoryName, fastForward })}
      isRunning={isRunning}
      error={failure?.text ?? null}
      errorHeading={failure?.heading}
      blockedReason={blockedReason}
      onConfirm={() => onConfirm({ fastForward })}
      onCancel={onCancel}
    >
      <label
        className={`mt-3 flex items-start gap-2 text-[12.5px] ${
          fastForwardReason !== null ? 'cursor-not-allowed text-faint' : 'cursor-pointer text-fg'
        }`}
        // ADR-0025: the option stays visible when it cannot apply, and says why.
        title={fastForwardReason ?? undefined}
      >
        <input
          type="checkbox"
          className="mt-0.5 accent-accent disabled:cursor-not-allowed"
          checked={fastForward}
          disabled={fastForwardReason !== null || isRunning}
          title={fastForwardReason ?? undefined}
          onChange={(event) => setFastForwardChosen(event.target.checked)}
        />
        <span>
          Fast Forward
          <span className="block text-faint">
            {fastForwardReason ??
              `Moves ${target.into} to ${target.branch} without a merge commit (git merge --ff-only). Unchecked, a merge commit is always created (--no-ff).`}
          </span>
        </span>
      </label>
    </ConfirmActionDialog>
  )
}
