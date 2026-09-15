# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
- The commit log and commit detail responses now carry the repository's remote names, read
  from its own `refs/remotes`. ([#6])

### Fixed

- A ref pill no longer claims a branch is in sync with a remote that does not exist. Remote
  refs are recognised by the repository's actual remote names rather than an assumed
  `origin/` prefix, so a local branch named `origin/main` in a repository with no remotes
  is shown as the local branch it is, and remotes named anything other than `origin` are no
  longer mislabelled. ([#1], [#6])
- A tag whose name contains a comma — for example `v1,origin/release` — no longer forges a
  remote onto an unrelated branch's pill. Ref decorations are split on `", "`, which cannot
  occur inside a ref name. ([#6])

[#1]: https://github.com/binaryplease/git-graph/issues/1
[#6]: https://github.com/binaryplease/git-graph/pull/6
