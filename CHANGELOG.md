# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING** — `git-graph/components` now exports `CommitRefRow`, a commit row's refs
  whole (the checked-out ring followed by the pills, on one line), and no longer exports
  the bare `CheckedOutMarker`. The arrangement is the thing worth sharing: the ring
  carries no name on screen, so it only reads as "checked out" while it sits immediately
  before the pills it qualifies, and a host given a loose marker to place itself is free
  to break that while still rendering both parts (ADR-0027 Rule 1). Embedders that drew
  the ring themselves render `<CommitRefRow>` instead and stop deriving which branch it
  names. ([#6])
- **BREAKING** — `CommitGraph` now takes a required `remotes` prop (the repository's
  remote names, as `CommitLog.remotes`). Embedders of `git-graph/components` must pass
  it; there is no default, because an empty array has to mean "this repository has no
  remotes" and no value can stand for "the host did not say" — a pill would otherwise
  guess a remote and claim a branch is in sync with a ref that may not exist. ([#6])
- A branch and the remotes that agree with it now render as **one ref pill** instead of
  one pill per decoration: the branch is named once and each remote is appended as a
  further segment, divided by a hairline (`main │ origin`). Refs are grouped by identity,
  so a diverged branch and remote keep separate pills and tags are never folded in.
  ([#1], [#6])
- The checked-out branch reads as checked out through the pill's own state — head colour,
  heavier name, a ring — plus a lane-coloured ring in the row that names the branch in its
  tooltip and to screen readers. The raw `HEAD -> ` plumbing text and the `⇅` glyph are
  gone; `⇅` is git's own mark for divergence, so it asserted the opposite of the agreement
  the pill reports. ([#6])
- The commit log and commit detail responses now carry the repository's remote names: the
  names `git remote` lists, kept only where `refs/remotes` holds refs for them. A
  remote-tracking ref with no configured remote behind it (a git-svn `refs/remotes/origin/
  trunk`, or a `git fetch <url> +refs/heads/*:refs/remotes/adhoc/*`) therefore no longer
  classifies as remote-tracking and renders as a local branch under its qualified name.
  ([#6])

### Fixed

- Ref decorations are read in their short form regardless of the user's `log.decorate`
  setting. `%d`/`%D` honour that config, and `log.decorate=full` in a `~/.gitconfig` made
  every decoration arrive as `refs/heads/main` / `refs/remotes/origin/main` — which the
  pills read as two unrelated local branches, never unified, with a compare link the
  server rejected. `--decorate=short` is now pinned on both the log and the detail read.
- The branch listing (and with it the compare membership guard and the default-branch
  resolution) no longer depends on git's ambiguity-sensitive ref shortening. A local branch
  `origin/main` next to `refs/remotes/origin/main` listed as `heads/origin/main`, so the
  compare link its pill built was rejected as an unknown branch; and `origin/HEAD` pointing
  at such a colliding name shortened to `remotes/origin/…`, which the `origin/` strip could
  not undo, so the default silently fell back to `main`. Both now read the full refname and
  strip the structural prefix.
- A configured-but-unfetched remote whose name is a path prefix of a fetched one (`fork`
  next to `fork/alice`, possible through a hand-edited config) is no longer reported as a
  remote on the strength of the longer name's refs; a ref counts only for the longest
  configured name that prefixes it.
- Opening a file diff no longer spawns the two `git` processes that read the remote names
  the commit detail carries; the file diff never used them.
- A ref pill no longer claims a branch is in sync with a remote that does not exist. Remote
  refs are recognised by the repository's actual remote names rather than an assumed
  `origin/` prefix, so a local branch named `origin/main` in a repository with no remotes
  is shown as the local branch it is, and remotes named anything other than `origin` are no
  longer mislabelled. ([#1], [#6])
- A tag whose name contains a comma — for example `v1,origin/release` — no longer forges a
  remote onto an unrelated branch's pill. Ref decorations are split on `", "`, which cannot
  occur inside a ref name. ([#6])
- A ref pill no longer forges a remote out of the long `remotes/…` decoration form. The
  `remotes/` prefix was treated as evidence about what followed it, so the perfectly legal
  local branch `remotes/origin/feature` was read as `origin`'s branch `feature` — and a
  sibling branch `feature` folded it in and claimed to be in sync with
  `refs/remotes/origin/feature`, a ref that exists nowhere. The prefix now gets no special
  handling: a decoration is remote-tracking only when it matches a reported remote name
  whole, with nothing stripped from it first. git never prints the long form for an actual
  remote-tracking ref in `%d`/`%D`, so this only ever named a local branch. ([#6])
- Remote names are no longer mangled when a remote's own name contains a slash.
  `git remote add fork/alice …` is legal, and `refs/remotes/fork/alice/main` was being cut
  at its first slash into a remote `fork` and a branch `alice/main` — neither of which
  exists — so a branch tracked on such a remote never unified with it. Names now come from
  `git remote`, the only listing that knows them, filtered by `refs/remotes` so a
  configured-but-never-fetched remote still cannot claim a same-named local branch. ([#6])
- A repository holding both `refs/heads/origin/main` and `refs/remotes/origin/main` no
  longer reports a remote called `remotes`. Ref shortening disambiguates the second as
  `remotes/origin/main`, and reading that short name structurally invented the bogus name
  while dropping `origin` entirely; full `%(refname)` values have one shape. ([#6])
- The copy button on a ref pill always yields a ref that resolves. For a name that exists
  on several remotes and nowhere locally the pill reads `shared`, and the copy value was
  taken from that label — putting a bare `shared` on the clipboard, which git cannot look
  up. It now copies `origin/shared`. ([#6])

[#1]: https://github.com/binaryplease/git-graph/issues/1
[#6]: https://github.com/binaryplease/git-graph/pull/6
