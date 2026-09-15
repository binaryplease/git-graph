import { describe, expect, test } from 'bun:test'
import {
  classifyRefDecoration,
  groupRefDecorations,
  refGroupLabel,
  refGroupTitle,
} from './refGroup'

// The grouping contract, stated as the cases that made it exist: a branch that
// agrees with its remotes is one ref, a branch that has diverged from its
// remote is two, and a tag is never either of them.

describe('classifyRefDecoration', () => {
  test('recognises the checked-out branch, a plain branch, and a tag', () => {
    expect(classifyRefDecoration('HEAD -> main')).toEqual({
      kind: 'branch',
      name: 'main',
      isHead: true,
    })
    expect(classifyRefDecoration('feature')).toEqual({
      kind: 'branch',
      name: 'feature',
      isHead: false,
    })
    expect(classifyRefDecoration('tag: v1.0')).toEqual({ kind: 'tag', name: 'v1.0' })
  })

  test('a bare HEAD is the detached pointer, not a branch', () => {
    expect(classifyRefDecoration('HEAD')).toEqual({ kind: 'head' })
  })

  test('a decoration is remote only when its prefix names a real remote', () => {
    expect(classifyRefDecoration('fork/main', ['origin', 'fork'])).toEqual({
      kind: 'remote',
      name: 'main',
      remote: 'fork',
    })
    // The classification git's own listing rules out: `feature` is not a remote,
    // so this is a local branch whose name happens to contain a slash. The
    // `origin/`-prefix guess this replaces called it a remote-tracking ref.
    expect(classifyRefDecoration('feature/main', ['origin'])).toEqual({
      kind: 'branch',
      name: 'feature/main',
      isHead: false,
    })
  })

  test('a remote named with a slash splits on the longest match', () => {
    expect(classifyRefDecoration('fork/alice/main', ['fork', 'fork/alice'])).toEqual({
      kind: 'remote',
      name: 'main',
      remote: 'fork/alice',
    })
  })

  test('the long `remotes/` form is the same ref as the short one', () => {
    expect(classifyRefDecoration('remotes/upstream/main', ['upstream'])).toEqual({
      kind: 'remote',
      name: 'main',
      remote: 'upstream',
    })
  })

  test('with no remote names at all, git’s default name is still recognised', () => {
    expect(classifyRefDecoration('origin/main', [])).toEqual({
      kind: 'remote',
      name: 'main',
      remote: 'origin',
    })
  })

  test('blank decorations are dropped', () => {
    expect(classifyRefDecoration('   ')).toBeNull()
    expect(classifyRefDecoration('tag: ')).toBeNull()
  })
})

describe('groupRefDecorations', () => {
  test('a branch and its remote on the same commit are one group', () => {
    const groups = groupRefDecorations(['HEAD -> main', 'origin/main'], ['origin'])
    expect(groups).toEqual([
      {
        kind: 'branch',
        name: 'main',
        isHead: true,
        remotes: ['origin'],
        decorations: ['HEAD -> main', 'origin/main'],
      },
    ])
  })

  test('several remotes tracking the same name collapse into that one group', () => {
    const groups = groupRefDecorations(
      ['HEAD -> main', 'origin/main', 'upstream/main'],
      ['origin', 'upstream'],
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.remotes).toEqual(['origin', 'upstream'])
    expect(groups[0]!.isHead).toBe(true)
  })

  test('a diverged branch and remote decorate different commits, so neither claims a sync', () => {
    // This is the whole safety property: the input is one commit's decorations,
    // so refs on different commits can never meet.
    const localRow = groupRefDecorations(['HEAD -> main'], ['origin'])
    const remoteRow = groupRefDecorations(['origin/main'], ['origin'])
    expect(localRow).toEqual([
      {
        kind: 'branch',
        name: 'main',
        isHead: true,
        remotes: [],
        decorations: ['HEAD -> main'],
      },
    ])
    expect(remoteRow).toEqual([
      {
        kind: 'remote',
        name: 'main',
        isHead: false,
        remotes: ['origin'],
        decorations: ['origin/main'],
      },
    ])
    expect(refGroupLabel(localRow[0]!)).toEqual({ text: 'main', markerRemotes: [] })
    expect(refGroupLabel(remoteRow[0]!)).toEqual({ text: 'origin/main', markerRemotes: [] })
  })

  test('a remote-only branch stays a single remote ref', () => {
    const groups = groupRefDecorations(['origin/feature'], ['origin'])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.kind).toBe('remote')
    expect(groups[0]!.name).toBe('feature')
    expect(refGroupLabel(groups[0]!).text).toBe('origin/feature')
  })

  test('a tag is never folded into a branch of the same name', () => {
    const groups = groupRefDecorations(
      ['HEAD -> v1.0', 'origin/v1.0', 'tag: v1.0'],
      ['origin'],
    )
    expect(groups.map((group) => [group.kind, group.name])).toEqual([
      ['branch', 'v1.0'],
      ['tag', 'v1.0'],
    ])
    expect(groups[1]!.remotes).toEqual([])
  })

  test('a detached HEAD stays its own pill beside the branches at that commit', () => {
    const groups = groupRefDecorations(['HEAD', 'main', 'origin/main'], ['origin'])
    expect(groups.map((group) => [group.kind, group.name])).toEqual([
      ['head', 'HEAD'],
      ['branch', 'main'],
    ])
    // HEAD is detached, so `main` is not the checked-out branch.
    expect(groups[1]!.isHead).toBe(false)
  })

  test('the remote listed before the local branch still yields one local group', () => {
    const groups = groupRefDecorations(['origin/topic', 'topic'], ['origin'])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.kind).toBe('branch')
    expect(groups[0]!.remotes).toEqual(['origin'])
  })

  test('a repeated remote is only counted once', () => {
    const groups = groupRefDecorations(
      ['main', 'origin/main', 'remotes/origin/main'],
      ['origin'],
    )
    expect(groups[0]!.remotes).toEqual(['origin'])
  })

  test('undecorated commits yield no groups', () => {
    expect(groupRefDecorations([])).toEqual([])
  })
})

describe('refGroupLabel', () => {
  test('a synced branch names itself once and marks its remotes', () => {
    const [group] = groupRefDecorations(
      ['HEAD -> main', 'origin/main', 'upstream/main'],
      ['origin', 'upstream'],
    )
    expect(refGroupLabel(group!)).toEqual({ text: 'main', markerRemotes: ['origin', 'upstream'] })
  })

  test('a name on several remotes but no local branch marks them all', () => {
    const [group] = groupRefDecorations(
      ['origin/shared', 'upstream/shared'],
      ['origin', 'upstream'],
    )
    expect(group!.kind).toBe('remote')
    expect(refGroupLabel(group!)).toEqual({ text: 'shared', markerRemotes: ['origin', 'upstream'] })
  })

  test('a tag prints its bare name', () => {
    const [group] = groupRefDecorations(['tag: v1.0'])
    expect(refGroupLabel(group!)).toEqual({ text: 'v1.0', markerRemotes: [] })
  })
})

describe('refGroupTitle', () => {
  test('a unified pill spells out the refs it merged', () => {
    const [group] = groupRefDecorations(['HEAD -> main', 'origin/main'], ['origin'])
    expect(refGroupTitle(group!)).toBe(
      'local branch main (checked out) — in sync with origin/main',
    )
  })

  test('a local-only branch claims no remote', () => {
    const [group] = groupRefDecorations(['feature'], ['origin'])
    expect(refGroupTitle(group!)).toBe(
      'local branch feature — no remote-tracking ref at this commit',
    )
  })

  test('a remote-only ref and a tag say what they are', () => {
    const [remoteGroup] = groupRefDecorations(['origin/feature'], ['origin'])
    expect(refGroupTitle(remoteGroup!)).toBe(
      'remote-tracking branch origin/feature — no local branch',
    )
    const [tagGroup] = groupRefDecorations(['tag: v1.0'])
    expect(refGroupTitle(tagGroup!)).toBe('tag v1.0')
  })

  test('a detached HEAD says so', () => {
    const [group] = groupRefDecorations(['HEAD'])
    expect(refGroupTitle(group!)).toBe('detached HEAD — no branch is checked out at this commit')
  })
})
