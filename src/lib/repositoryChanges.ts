import { useEffect, useRef } from 'react'

// "This repository changed on disk" as a signal between the app's own tabs. A
// checkout runs in the graph tab, but the working-tree view it changes may be
// open in another (the `/working` diff tab the graph's uncommitted-changes row
// opens), and that tab has no other way to learn its listing went stale. A
// BroadcastChannel reaches every same-origin tab and never the sender, so the
// tab that ran the action refetches on its own and the others follow.
//
// App-only (ADR-0032): it is about this app's tabs, not about rendering, so it
// stays out of the component barrel — a host decides for itself how its own
// views learn of a change.

const CHANNEL_NAME = 'git-graph:repository-changes'

type RepositoryChangeMessage = { repositoryRelativePath: string }

const channelIsAvailable = () => typeof BroadcastChannel !== 'undefined'

/** Tell the app's other tabs that a repository changed on disk. */
export function announceRepositoryChange(repositoryRelativePath: string): void {
  if (!channelIsAvailable()) return
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.postMessage({ repositoryRelativePath } satisfies RepositoryChangeMessage)
  channel.close()
}

/** Run `onChange` whenever another tab announces a change to this repository. */
export function useRepositoryChanges(repositoryRelativePath: string | null, onChange: () => void): void {
  // Held in a ref so a new callback identity does not reopen the channel.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (repositoryRelativePath === null || !channelIsAvailable()) return
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<RepositoryChangeMessage>) => {
      if (event.data?.repositoryRelativePath === repositoryRelativePath) onChangeRef.current()
    }
    return () => channel.close()
  }, [repositoryRelativePath])
}
