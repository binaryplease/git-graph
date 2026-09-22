# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A git-action context menu, with checkout as the first write the service has
  ever had.** Right-click a commit row or a ref pill, or press `Shift+F10` or the
  context-menu key on a focused row. The menu can check out a local branch, a
  tag, or a commit. A tag or commit checkout detaches `HEAD`, and the menu warns
  about that before running it. The menu also copies the full or short hash, opens
  the commit in the `/commit` tab, and compares a branch against the default
  branch. Entries that cannot apply stay visible, disabled, with the reason as
  their title (ADR-0025). Every checkout states the command and the repository
  and runs only on confirm. After it succeeds, the graph, the working-tree row and
  any open `/working` tab refetch. If git refuses (for example, uncommitted
  changes it would overwrite), its stderr is shown verbatim. `POST
  /api/git/checkout` holds the read routes' membership line: the branch against
  `refs/heads`, the tag against `refs/tags`, the commit against the history
  reachable from a ref or `HEAD`. It also requires the `X-Git-Graph-Action: 1`
  header and a JSON body, and refuses browser requests marked cross-site, so a
  foreign page cannot trigger it. The menu (`GitActionMenu`) and its confirmation
  (`ConfirmActionDialog`) are fetch-free barrel components. Their wording
  (`buildGitMenuSections`, `describeCheckout`) lives in `git-graph/shared`.
  `CommitGraph` gains an `onContextMenu` seam, and `GitCommit` gains `fullHash`
  (git `%H`). ([#2], [#12])

### Security

- **BREAKING** — **The server now answers only for the host names it is
  reachable under, closing DNS rebinding.** A page a user visited could point its own domain at
  `127.0.0.1`, making the service same-origin with it in the browser, and then
  read every repository under the served root and run `POST /api/git/checkout`
  (whose cross-origin gate a rebound request passes). Every request, on every
  route and whatever the bind address, must now carry a `Host` of `localhost`,
  the `127.0.0.0/8` block, or `[::1]` (with or without a port), or a name listed
  in `GIT_GRAPH_ALLOWED_HOSTS`. Any other name gets `421`, and a request with
  no `Host` or a malformed one gets `400`. **Operators:** a reverse proxy that
  passes its public host through in `Host` (Caddy's default) must now list that
  name in `GIT_GRAPH_ALLOWED_HOSTS` (NixOS: `allowedHosts`) even when the
  service binds loopback. The `/api` discovery document no longer reflects an
  unvalidated `Host` or `X-Forwarded-Host`. It names the validated host, and
  honours a forwarded one only when the server itself serves that name. The
  checkout's cross-origin gate also refuses an `Origin` naming a host outside
  the same allowlist, which it previously admitted when no `Sec-Fetch-Site` was
  sent. ([#5], [#12])

### Changed

- The expanded commit detail now reads **metadata → commit message → changed files** in
  both variants, and the message renders verbatim including its title line — blank lines
  and indentation preserved. Previously the message body came first, the metadata second,
  and the inline variant never showed the subject at all, so a subject too long for its
  commit row was unreadable anywhere in the expanded view. The sidebar keeps its subject
  header; the title line repeating inside the message block there is accepted. No API,
  layout-algorithm, or diff-view change. ([#10], [#11])

- The monospace font is now Fira Code, self-hosted via `@fontsource-variable/fira-code`
  (variable weight 300–700, woff2 per unicode subset, bundled — no font CDN, ADR-0016).
  `--font-mono` in `src/theme.css` names it ahead of the previous system stack, which
  stays as the fallback while the face loads. The `@font-face` import lives in
  `theme.css` rather than `index.css` so an embedding host that imports
  `git-graph/theme.css` gets the font, not just a token pointing at one it was never
  given (ADR-0027). `@git-diff-view/react` hardcodes `Menlo, Consolas, monospace` as an
  inline style on its table wrappers, so `theme.css` overrides those four classes with
  `!important` — otherwise the diff body kept a font that resolves nowhere on Linux and
  fell back to the generic `monospace` while the chrome around it changed. ([#11])

## [0.2.0] — 2026-09-15

### Changed

- **BREAKING** — `git-graph/components` now exports `CommitRefRow`, a commit row's refs
  whole (the checked-out ring followed by the pills, on one line), and no longer exports
  the bare `CheckedOutMarker`. The arrangement is the thing worth sharing: the ring
  carries no name on screen, so it only reads as "checked out" while it sits immediately
  before the pills it qualifies, and a host given a loose marker to place itself is free
  to break that while still rendering both parts (ADR-0027 Rule 1). Embedders that drew
  the ring themselves render `<CommitRefRow>` instead and stop deriving which branch it
  names. ([#9])
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
  ([#6], [#9])

### Fixed

- Ref decorations are read in their short form regardless of the user's `log.decorate`
  setting. `%d`/`%D` honour that config, and `log.decorate=full` in a `~/.gitconfig` made
  every decoration arrive as `refs/heads/main` / `refs/remotes/origin/main` — which the
  pills read as two unrelated local branches, never unified, with a compare link the
  server rejected. `--decorate=short` is now pinned on both the log and the detail read.
  ([#9])
- The branch listing (and with it the compare membership guard and the default-branch
  resolution) no longer depends on git's ambiguity-sensitive ref shortening. A local branch
  `origin/main` next to `refs/remotes/origin/main` listed as `heads/origin/main`, so the
  compare link its pill built was rejected as an unknown branch; and `origin/HEAD` pointing
  at such a colliding name shortened to `remotes/origin/…`, which the `origin/` strip could
  not undo, so the default silently fell back to `main`. Both now read the full refname and
  strip the structural prefix. ([#9])
- A configured-but-unfetched remote whose name is a path prefix of a fetched one (`fork`
  next to `fork/alice`, possible through a hand-edited config) is no longer reported as a
  remote on the strength of the longer name's refs; a ref counts only for the longest
  configured name that prefixes it. ([#9])
- Opening a file diff no longer spawns the two `git` processes that read the remote names
  the commit detail carries; the file diff never used them. ([#9])
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
  remote-tracking ref in `%d`/`%D`, so this only ever named a local branch. ([#9])
- Remote names are no longer mangled when a remote's own name contains a slash.
  `git remote add fork/alice …` is legal, and `refs/remotes/fork/alice/main` was being cut
  at its first slash into a remote `fork` and a branch `alice/main` — neither of which
  exists — so a branch tracked on such a remote never unified with it. Names now come from
  `git remote`, the only listing that knows them, filtered by `refs/remotes` so a
  configured-but-never-fetched remote still cannot claim a same-named local branch. ([#9])
- A repository holding both `refs/heads/origin/main` and `refs/remotes/origin/main` no
  longer reports a remote called `remotes`. Ref shortening disambiguates the second as
  `remotes/origin/main`, and reading that short name structurally invented the bogus name
  while dropping `origin` entirely; full `%(refname)` values have one shape. ([#9])
- The copy button on a ref pill always yields a ref that resolves. For a name that exists
  on several remotes and nowhere locally the pill reads `shared`, and the copy value was
  taken from that label — putting a bare `shared` on the clipboard, which git cannot look
  up. It now copies `origin/shared`. ([#9])

[Unreleased]: https://github.com/binaryplease/git-graph/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/binaryplease/git-graph/compare/v0.1.0...v0.2.0

[#1]: https://github.com/binaryplease/git-graph/issues/1
[#2]: https://github.com/binaryplease/git-graph/issues/2
[#5]: https://github.com/binaryplease/git-graph/issues/5
[#6]: https://github.com/binaryplease/git-graph/pull/6
[#9]: https://github.com/binaryplease/git-graph/pull/9
[#10]: https://github.com/binaryplease/git-graph/issues/10
[#11]: https://github.com/binaryplease/git-graph/pull/11
[#12]: https://github.com/binaryplease/git-graph/pull/12
