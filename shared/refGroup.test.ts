import { describe, expect, test } from 'bun:test'
import { parseRefDecorations } from './gitLog'
import {
  classifyRefDecoration,
  groupRefDecorations,
  refGroupCopyValue,
  refGroupLabel,
  refGroupTitle,
} from './refGroup'

// The grouping contract, stated as the cases that made it exist: a branch that
// agrees with its remotes is one ref, a branch that has diverged from its
// remote is two, and a tag is never either of them.

describe('classifyRefDecoration', () => {
  test('recognises the checked-out branch, a plain branch, and a tag', () => {
    expect(classifyRefDecoration('HEAD -> main', [])).toEqual({
      kind: 'branch',
      name: 'main',
      isHead: true,
    })
    expect(classifyRefDecoration('feature', [])).toEqual({
      kind: 'branch',
      name: 'feature',
      isHead: false,
    })
    expect(classifyRefDecoration('tag: v1.0', [])).toEqual({ kind: 'tag', name: 'v1.0' })
  })

  test('a bare HEAD is the detached pointer, not a branch', () => {
    expect(classifyRefDecoration('HEAD', [])).toEqual({ kind: 'head' })
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

  // Regression: a `remotes/…` decoration never names a remote-tracking ref, so
  // the prefix gets no special handling. git shortens remote-tracking refs to
  // `origin/main` in `%d`/`%D` and does not disambiguate there (a repository
  // holding both `refs/heads/origin/main` and `refs/remotes/origin/main` prints
  // `origin/main` twice), so the long form only ever arrives as the name of a
  // local branch someone created — `git branch remotes/origin/feature` is
  // accepted and prints as exactly that.
  //
  // Two guesses have been removed here in turn. The first read the leading
  // segment as the remote when nothing matched. The second survived it: the
  // prefix was still *stripped* before matching, so with `origin` configured
  // this branch was read as `origin`'s `feature` — and a sibling local
  // `feature` folded it in and claimed a sync with `refs/remotes/origin/feature`,
  // a ref that exists nowhere. Matching the decoration whole is what tells a
  // local branch from a remote-tracking ref.
  test('a `remotes/` decoration is a local branch, whatever the remotes are', () => {
    // No remotes at all.
    expect(classifyRefDecoration('remotes/foo/bar', [])).toEqual({
      kind: 'branch',
      name: 'remotes/foo/bar',
      isHead: false,
    })
    // The leading segment is not a remote.
    expect(classifyRefDecoration('remotes/foo/bar', ['origin'])).toEqual({
      kind: 'branch',
      name: 'remotes/foo/bar',
      isHead: false,
    })
    // The leading segment *is* a remote — the case the strip used to forge.
    expect(classifyRefDecoration('remotes/origin/feature', ['origin'])).toEqual({
      kind: 'branch',
      name: 'remotes/origin/feature',
      isHead: false,
    })
  })

  test('no remotes means no remote for the long form either', () => {
    const groups = groupRefDecorations(['bar', 'remotes/foo/bar'], [])
    expect(groups.map((group) => [group.kind, group.name, group.remotes])).toEqual([
      ['branch', 'bar', []],
      ['branch', 'remotes/foo/bar', []],
    ])
    expect(groups.every((group) => refGroupLabel(group).markerRemotes.length === 0)).toBe(true)
    expect(groups.map(refGroupTitle).some((title) => title.includes('in sync'))).toBe(false)
  })

  // The failure reproduced against real git: remote `origin` is fetched, and the
  // local branches `feature` and `remotes/origin/feature` sit on one commit.
  // `refs/remotes/origin/feature` does not exist, so nothing here may say it
  // does.
  test('a local branch named remotes/<remote>/<x> never forges a sync onto its namesake', () => {
    const groups = groupRefDecorations(
      ['HEAD -> main', 'origin/main', 'remotes/origin/feature', 'feature'],
      ['origin'],
    )
    expect(groups.map((group) => [group.kind, group.name, group.remotes])).toEqual([
      // `main` really is in sync with `origin/main` — that claim is git's.
      ['branch', 'main', ['origin']],
      ['branch', 'remotes/origin/feature', []],
      ['branch', 'feature', []],
    ])
    const featureGroup = groups[2]!
    expect(refGroupLabel(featureGroup).markerRemotes).toEqual([])
    expect(refGroupTitle(featureGroup)).toBe(
      'local branch feature — no remote-tracking ref at this commit',
    )
  })

  // Regression: an empty remote list is git's authoritative "this repository has
  // no remote-tracking refs", so `origin/main` there is a *local branch* someone
  // created with that name. Guessing `origin` produced a pill claiming a sync
  // with `refs/remotes/origin/main`, a ref that does not exist in the repository
  // at all — the one claim acceptance criterion 4 forbids.
  test('no remotes means no remote: a local branch named origin/main is not remote-tracking', () => {
    expect(classifyRefDecoration('origin/main', [])).toEqual({
      kind: 'branch',
      name: 'origin/main',
      isHead: false,
    })
    const groups = groupRefDecorations(['HEAD -> main', 'origin/main'], [])
    expect(groups.map((group) => [group.kind, group.name, group.remotes])).toEqual([
      ['branch', 'main', []],
      ['branch', 'origin/main', []],
    ])
    // No pill invents a marker, and no tooltip claims a sync.
    expect(groups.every((group) => refGroupLabel(group).markerRemotes.length === 0)).toBe(true)
    expect(groups.map(refGroupTitle).some((title) => title.includes('in sync'))).toBe(false)
  })

  // Regression: `HEAD -> x` is git stating HEAD is on x, and HEAD is only ever
  // on a local branch. Reading `HEAD -> origin/other` as a remote-tracking ref
  // dropped the HEAD marker and let the branch collect remotes not its own.
  test('a checked-out branch named like a remote ref stays a local branch', () => {
    expect(classifyRefDecoration('HEAD -> origin/other', ['origin'])).toEqual({
      kind: 'branch',
      name: 'origin/other',
      isHead: true,
    })
    const [group] = groupRefDecorations(['HEAD -> origin/other'], ['origin'])
    expect(group!.isHead).toBe(true)
    expect(refGroupLabel(group!)).toEqual({ text: 'origin/other', markerRemotes: [] })
  })

  test('blank decorations are dropped', () => {
    expect(classifyRefDecoration('   ', [])).toBeNull()
    expect(classifyRefDecoration('tag: ', [])).toBeNull()
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

  // The dedup guard in its own right. This used to be exercised with
  // `remotes/origin/main` as the repeat, which stopped being a second reading of
  // `origin/main` once the `remotes/` strip was removed — it is a local branch
  // of its own name now, and would have left the guard untested.
  test('a repeated remote is only counted once', () => {
    const groups = groupRefDecorations(['main', 'origin/main', 'origin/main'], ['origin'])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.remotes).toEqual(['origin'])
    expect(groups[0]!.decorations).toEqual(['main', 'origin/main', 'origin/main'])
  })

  test('undecorated commits yield no groups', () => {
    expect(groupRefDecorations([], [])).toEqual([])
  })

  // Regression, end to end from git's own output: a tag named `v1,origin/release`
  // must not manufacture a remote for the `release` branch. Parsing and grouping
  // are tested together here because the forgery needed both halves — a torn
  // decoration plus a grouper willing to fold the fragment in.
  test('a comma in a tag name cannot forge a remote onto another branch', () => {
    const decorations = parseRefDecorations(
      ' (HEAD -> main, tag: v1,origin/release, origin/main, release)',
    )
    const groups = groupRefDecorations(decorations, ['origin'])
    expect(groups.map((group) => [group.kind, group.name, group.remotes])).toEqual([
      ['branch', 'main', ['origin']],
      ['tag', 'v1,origin/release', []],
      ['branch', 'release', []],
    ])
    // `release` has no remote-tracking ref here, and its pill says so.
    const releaseGroup = groups[2]!
    expect(refGroupLabel(releaseGroup).markerRemotes).toEqual([])
    expect(refGroupTitle(releaseGroup)).toBe(
      'local branch release — no remote-tracking ref at this commit',
    )
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
    const [group] = groupRefDecorations(['tag: v1.0'], [])
    expect(refGroupLabel(group!)).toEqual({ text: 'v1.0', markerRemotes: [] })
  })
})

// What a copy button hands the user has one requirement the pill's label does
// not: it has to be a ref `git` can actually look up.
describe('refGroupCopyValue', () => {
  // Regression: `refGroupLabel` drops the qualifier for a name that lives on
  // several remotes and nowhere locally, so copying the label handed over a
  // bare `shared` — which resolves to nothing. Before ref grouping existed this
  // copied `origin/shared`.
  test('a name on several remotes but no local branch copies a qualified ref', () => {
    const [group] = groupRefDecorations(['origin/shared', 'upstream/shared'], ['origin', 'upstream'])
    // The pill still says `shared` — that rendering is deliberate and separate.
    expect(refGroupLabel(group!).text).toBe('shared')
    // The copied value names a ref that exists.
    expect(refGroupCopyValue(group!)).toBe('origin/shared')
  })

  test('a ref on one remote copies the qualified name it already shows', () => {
    const [group] = groupRefDecorations(['origin/feature'], ['origin'])
    expect(refGroupCopyValue(group!)).toBe('origin/feature')
    expect(refGroupCopyValue(group!)).toBe(refGroupLabel(group!).text)
  })

  test('a local branch copies its own name, remotes or not', () => {
    const [synced] = groupRefDecorations(['HEAD -> main', 'origin/main'], ['origin'])
    expect(refGroupCopyValue(synced!)).toBe('main')
    const [local] = groupRefDecorations(['feature'], ['origin'])
    expect(refGroupCopyValue(local!)).toBe('feature')
  })

  test('a tag and a detached HEAD copy names that resolve', () => {
    const [tag] = groupRefDecorations(['tag: v1.0'], [])
    expect(refGroupCopyValue(tag!)).toBe('v1.0')
    const [head] = groupRefDecorations(['HEAD'], [])
    expect(refGroupCopyValue(head!)).toBe('HEAD')
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
    const [tagGroup] = groupRefDecorations(['tag: v1.0'], [])
    expect(refGroupTitle(tagGroup!)).toBe('tag v1.0')
  })

  test('a detached HEAD says so', () => {
    const [group] = groupRefDecorations(['HEAD'], [])
    expect(refGroupTitle(group!)).toBe('detached HEAD — no branch is checked out at this commit')
  })
})
