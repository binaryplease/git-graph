# git-graph — AGENTS.md

A **local git commit-graph viewer**: a standalone web service that lists the
git repositories at a served root and renders their commit DAGs, and — its one
write — checks out a branch, tag, or commit from a context menu on the graph. Sibling of
`binp-file-explorer` in shape and conventions (local-machine service-first;
later embeddable in nightshift-ui as a module).

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | Primary runtime; `Bun.spawn` runs git. |
| Server | Elysia | Per ADR-0003. |
| Validation | Zod (v4 API via `zod/v4`) | Boundary validation (ADR-0013). Route schemas use Zod, never TypeBox (ADR-0014); schemas double as the OpenAPI spec via `z.toJSONSchema`. |
| API docs | `@elysiajs/openapi` | ADR-0020: discovery at `GET /api`, Scalar UI at `GET /api/docs`, spec at `GET /api/openapi.json`. |
| Frontend | React 19 | |
| Styling | Tailwind CSS v4 | `@tailwindcss/vite` plugin; palette + lane tokens in `src/theme.css` (imported by `index.css`, shared verbatim with a host via `git-graph/theme.css`, ADR-0027). Light/dark/system theme re-skins by overriding the same custom properties under `[data-theme="light"]`. |
| Mono font | Fira Code (`@fontsource-variable/fira-code`) | The `--font-mono` token in `src/theme.css`; the woff2 subsets are bundled from node_modules, never fetched from a font CDN (ADR-0016). The `@import` sits in `theme.css`, not `index.css`, so a host importing `git-graph/theme.css` gets the face the token names. `@git-diff-view` writes `Menlo, Consolas, monospace` as an inline style on its four table wrappers and offers no prop for it, so `theme.css` overrides them by class with `!important` — without that the diff body, the largest mono surface, ignores the token. |
| Icons | `@tabler/icons-react` | ADR-0022 — never Unicode characters as icons. |
| Diff view | `@git-diff-view/react` + `@git-diff-view/shiki` | Pinned exactly at `0.1.7` (pre-1.0). Whole-file tokenization for the diff views (inline unified in the panel, full-tab split for the standalone commit/compare tabs) — beats per-line highlighting (diff2html). First substantial third-party runtime UI dependency; ADR still open. |
| Build | Vite (client) + Bun bundler (server + CLI) | client → `dist/client/`, server + `bgg` CLI → `dist/server/`. |
| Packaging | Nix flake | `flake.nix` → the `bgg` standalone CLI + `git-graph` alias (`packages`/`apps`), a `devShell`, and a hardened `nixosModules.default` (`services.git-graph`). Mirrors binp-file-explorer's `bfe` flake. |
| Dev env | mise | `.mise.toml` declares tool versions, env vars, and tasks (ADR-0004). |

Dev ports are offset from binp-file-explorer so both run side by side:
Elysia **:3010**, Vite **:5183**. These are the *canonical request*, not a pin:
`mise run dev` (→ `scripts/dev.ts`) resolves them before launch per **ADR-0037
§2** — probing each on the bind host, announcing any reassignment, and pinning
the result (`PORT`, `VITE_PORT`, `VITE_API_TARGET`, strategy `strict`) into both
child processes so a stale session never forces manual port juggling and Vite's
`/api` proxy follows a moved server. The runtime binds stay strict (ADR-0018).

## Derivation (ADR-0006)

Scaffolded per ADR-0003 with infra/dev-env conventions adopted from a sibling
project (build scripts, ADR-0020 discovery skeleton, config shape). The
*product* is a port: the layout algorithm, renderer behaviour, and search UX
come verbatim from an internal single-file prototype (`@ 9f74265`) that was
verified in-browser against real multi-branch history. The algorithm itself is
pvigier's active-lane sweep, described publicly at
<https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html>;
that post, plus `shared/graphLayout.test.ts`'s pinned fixture, is the
reproducible reference — the prototype is not needed to work on this repo.

## Architecture — the three-consumer shape

The repo is deliberately layered so the same code serves all three future
consumers (standalone instance · shared package · nightshift-ui module):

- `shared/` — pure data-in/data-out logic with zero DOM or server imports:
  - `git.schema.ts` — the Zod-typed git boundary (ADR-0013): commit log, commit
    detail, file diff, branch listing, branch comparison, and the working tree.
  - `graphLayout.ts` — **the algorithm**. Verbatim port of the prototype's
    `computeLayout` (pvigier's active-lane sweep, as used by
    mhutchie/GitLens/GitKraken). Do not "improve" its behaviour without
    updating the regression fixture in `graphLayout.test.ts`, which pins the
    prototype-captured output.
  - `gitLog.ts` — `git log` wire format + parser (unit separator `%x1f`;
    `%H` rides along as `fullHash`, which "copy commit hash" and a commit
    checkout use, since an abbreviation can grow ambiguous). `%d`
    decorations split on `", "`, never on the bare comma: a comma is legal in a
    ref name, a space is not, so that is the only exact split — splitting on `,`
    tears the tag `v1,origin/release` into a fragment shaped like a
    remote-tracking ref, which `refGroup.ts` would then fold into an unrelated
    branch's pill as a remote that agrees with it.
  - `refGroup.ts` — folds a commit's `%d` decorations into one group per *ref
    identity*, so a local branch and the remotes pointing at the same commit
    render as one segmented pill (`main │ origin`) instead of one pill per
    decoration.
    Classification takes the repository's own remote names (`CommitLog.remotes`
    / `CommitDetail.remotes`) rather than guessing an `origin/` prefix, which is
    what tells the remote-tracking ref `fork/main` from a local `feature/main`.
    The remote list is a **required** argument (and a required `CommitGraph`
    prop) with no fallback *anywhere in the module*: an empty list is git's
    authoritative "no remotes here", so `origin/main` in such a repository is a
    local branch someone named that way, and guessing otherwise would claim a
    sync with a ref that does not exist. A decoration is remote-tracking only
    when it matches a reported remote name **whole**; nothing is stripped from it
    first. That is what settles the long `remotes/…` form, which gets no special
    handling at all: git shortens remote-tracking refs to `origin/main` in
    `%d`/`%D` and does not disambiguate there (a repository holding both
    `refs/heads/origin/main` and `refs/remotes/origin/main` prints `origin/main`
    twice), so `remotes/origin/feature` in a decoration is always a local branch
    someone created — `git branch remotes/origin/feature` is accepted and prints
    as exactly that. Two guesses were removed here in turn: reading the leading
    segment as the remote, and then merely *stripping* the prefix before matching,
    which read that branch as `origin`'s `feature` and let a sibling local
    `feature` claim a sync with a `refs/remotes/origin/feature` that exists
    nowhere.
    `HEAD -> x` likewise settles a case the short `%d` form cannot — HEAD
    is only ever on a local branch, so a checked-out `origin/other` is local.
    Names are matched **longest-first**, because a remote name may itself contain
    a slash (`git remote add fork/alice …` is accepted) and only the longest
    match splits `fork/alice/main` into the right remote and the right branch;
    the server produces such names whole (see below), so this is a shape the
    module really receives.
    Grouping only ever sees one commit's decorations, so a diverged branch and
    remote keep separate pills and no "synced" claim can be invented; ahead/
    behind counts would need `%(upstream:track)` and are deliberately absent
    (the shape leaves room for them per ADR-0029). Also owns the pill's display
    parts (`refGroupLabel`, `refGroupTitle`, `refGroupCopyValue`) so both
    surfaces and a host agree. The copy value is deliberately *not* the label:
    the label drops the remote qualifier for a name that lives on several remotes
    and nowhere locally (`origin/shared` + `upstream/shared` print as `shared`),
    and a bare `shared` resolves to nothing — what is copied always names a ref
    git can look up.
  - `commitDetail.ts` — `git show` wire format + parser for a single commit
    (header + `--raw`/`--numstat` file block, zipped positionally). Merges use
    `-m --first-parent`.
  - `fileDiff.ts` — `git show` argument list + `languageForPath` +
    `splitPatchIntoFileHunks` for a single file's diff (patch + both complete
    blobs; `--no-ext-diff --no-textconv` load-bearing).
  - `compareDiff.ts` — `git diff` argument shapes + `compareRevisionArguments`
    for a branch comparison: a three-dot `base...head` merge-base diff (the
    "what does this branch add" view a PR shows), falling back to two endpoints
    when the branches share no history.
  - `workingTree.ts` — `git diff` argument shapes + `EMPTY_TREE_HASH` for the
    working tree (uncommitted changes vs HEAD): a `git diff HEAD` summary reusing
    the commit-detail parser, plus per-file patch args for tracked files and an
    `--no-index` variant for untracked ones (`--no-ext-diff --no-textconv` stay
    load-bearing).
  - `fuzzy.ts` — subsequence fuzzy matcher with matched-character segments
    (ADR-0019).
  - `gitActions.ts` — the git-action context menu as data (issue #2): the one
    descriptor (ADR-0026) of which entries a commit row or a ref pill offers
    (`buildGitMenuSections`), why an entry cannot apply right now
    (`unavailableReason` — never a dropped entry, ADR-0025), where HEAD is
    (`findHeadState`, read off the log's own decorations), and what a checkout
    says before it runs (`describeCheckout`: the `git switch` command, the
    repository, the detached-HEAD warning, git's rule about uncommitted changes).
    A row menu lists the commit first and then every ref on it — which is what
    makes branch and tag checkout reachable from the keyboard, since pills are
    not focusable; a pill menu leads with its own ref.
  - `checkout.ts` — `git switch` argument shapes for a resolved checkout.
    `switch`, never `checkout` (which also restores paths); a branch after `--`
    with `--no-guess` (no silent tracking-branch creation), a detach target
    always a full `refs/tags/…` refname or a full hash, `advice.detachedHead=false`
    so git's report is one line.
  - `mutationRequest.ts` — the header (`X-Git-Graph-Action: 1`) every mutating
    request carries, shared by the client that sends it and the guard that checks
    it.
- `server/` — Elysia service. `services/git.ts` scans the served root and
  shells out to git. Everything untrusted is re-validated by **membership**
  against git's own listings before it reaches the shell — repository
  identifiers against the repo listing, file paths against a commit's/
  comparison's own file list, and branch refs against `git for-each-ref`.
  The log and the commit detail each also carry `remotes` — the repository's
  remote names, returned alongside the refs that need them, so the ref pills
  never guess at an `origin/` prefix and the standalone commit tab needs no
  extra fetch to group them. Reading them takes **both** of git's listings, and
  neither half survives alone: `git remote` is the only authority on what a
  remote is *called* (a name may contain a slash, and
  `refs/remotes/fork/alice/main` cannot be re-split into the remote `fork/alice`
  and the branch `main` without being told), while `refs/remotes` is what keeps a
  configured-but-never-fetched remote out of the list (only a remote with refs
  can appear in a decoration, so a bare `git remote` read would let an empty
  remote `foo` claim the local branch `foo/bar`). The refs are read as full
  `%(refname)`, never `%(refname:short)`: shortening is ambiguity-sensitive, so a
  repository holding both `refs/heads/origin/main` and `refs/remotes/origin/main`
  prints the latter as `remotes/origin/main` — and a structural read of that
  short name reports a remote called `remotes` while losing `origin` entirely.
  Beyond the log/detail/file-diff routes it serves `GET /api/git/branches`
  (with default-branch resolution), `/api/git/compare` (branch-vs-base file
  list), `/api/git/compare/diff` (one file of a comparison), and
  `/api/git/working` + `/api/git/working/diff` (the working tree — uncommitted
  changes vs HEAD, and one file of it; tracked via `git diff HEAD`, untracked via
  `git ls-files --others` diffed from `/dev/null`, membership-guarded path).
  - **The write surface** is exactly one route, `POST /api/git/checkout`
    (issue #2's first slice). It holds the read routes' membership line in
    `resolveCheckout`: a branch must be one `for-each-ref refs/heads` lists, a
    tag one `refs/tags` lists (handed on as the full refname, so a same-named
    branch cannot win), a commit hash must `rev-parse` to a commit whose full hash
    starts with it *and* be reachable from a ref or HEAD (`for-each-ref
    --contains` / `merge-base --is-ancestor` — the `git log --all` history); only
    git's own strings reach `git switch`. git's safety stays in charge: a refused
    switch (uncommitted changes it would overwrite) is a 409 whose message is
    git's stderr verbatim. In front of it, `services/mutation-guard.ts` (its own
    module, ADR-0032) is the cross-origin gate: the custom header, a JSON content
    type, and `Sec-Fetch-Site` (when sent) of `same-origin` — so a foreign page in
    the user's browser cannot fire a checkout at the loopback service (no CORS
    plugin is installed, so the preflight such a request needs is never granted).
    DNS rebinding is out of its reach and stays issue #5; the loopback default
    (ADR-0037 §4) is what makes an unauthenticated write route tolerable, and must
    not be relaxed for it. Later write actions (#2) join this route family with
    the same two guards. The posture is recorded corpus-wide as ADR-0044
    (proposed): membership-resolved targets, the cross-origin gate, loopback
    only.
  - Standalone surface (the on-demand instance consumer, mirroring
    binp-file-explorer's `bfe`): `server/cli.ts` + `server/cli/` is the `bgg`
    executable the flake installs — `serve` (foreground, browser-open) and a
    background `daemon` lifecycle (ADR-0015) over `/api/status`, each in its own
    module (`args` pure-parses argv, `paths` resolves the sibling server bundle
    per ADR-0011, `browser`, `daemon`). Port selection and exposure are their own
    dependency-light services (ADR-0032): `services/port.ts` (probe), `listen.ts`
    (`strict|auto` in-process walk), and `bind-exposure.ts` (the loopback-default
    gate). All three are **ADR-0037**: `auto` is the *default* strategy for every
    launch shape — a bare `bun server/index.ts`, `mise run start`, and the CLI —
    allocating in front of the strict bind, never as a silent runtime fallback;
    `strict` is reserved for an explicit operator pin (`bgg --port`,
    `GIT_GRAPH_PORT_STRATEGY=strict`, the NixOS `port` option). The server reports
    the *bound* port (banner, `/api/status`, the CLI ready-file handshake), and a
    non-loopback bind refuses to start without `GIT_GRAPH_ALLOWED_HOSTS`
    (ADR-0037 §4). `scripts/dev-ports.ts` composes the same `port.ts` for the dev
    resolver.
- `src/` — React client, one bundle with several entry points that `index.tsx`
  routes on `location.pathname`: the graph shell (`App.tsx`) and the standalone
  diff tabs `FileDiffPage` (`/diff`, one file), `CommitDiffPage` (`/commit`, a
  whole commit), `ComparePage` (`/compare`, a branch against a base), and
  `WorkingTreePage` (`/working`, uncommitted changes vs HEAD). Every
  rendering piece is fetch-free — `GitActionMenu.tsx` (the context menu a row or
  pill opens through `CommitGraph`'s `onContextMenu` seam: icons, the menu
  keyboard contract, and the rule that an action whose handler the host did not
  wire renders disabled with a reason, never absent; copying is its own, via the
  Clipboard API), `ConfirmActionDialog.tsx` (the statement a git write makes
  before it runs, and where git's refusal comes back, verbatim, to retry or
  cancel), `CommitGraph.tsx` (commits in, SVG + rows
  out), `CommitDetailPanel.tsx` (metadata, the verbatim commit message, changed
  files, copy-hash, parent navigation — in that order),
  `FileDiff.tsx` (one diff, unified or split by prop), `MultiFileDiffView.tsx`
  (file list on top + per-file diffs loaded lazily as each nears the viewport),
  `UncommittedChangesRow.tsx` (the working-tree node above HEAD),
  `RefPill.tsx` (ref decorations at two granularities: `RefPill`, one grouped
  ref — see `shared/refGroup.ts` — as a segmented badge, and `CommitRefRow`, a
  commit row's refs whole — the checked-out ring then the pills, on one line.
  The row cluster is the barrel-exported unit and the bare ring is *internal*,
  because the arrangement is the invariant: the ring carries no name on screen,
  so it only means "checked out" while it sits immediately before the pills it
  qualifies, and handing a host a loose marker to re-place is the under-sharing
  ADR-0027 Rule 1 names. The pill stays separately exported because its
  placement genuinely varies — the detail panel interleaves copy and compare
  controls between pills), plus shared
  tokens in `components/fileStatus.tsx` and chrome in `DiffTabFrame.tsx`. The
  shells (`App.tsx` and the four pages) own all fetching; `lib/diffRoutes.ts` is
  the single descriptor for the diff-tab URLs (ADR-0026) that the panel builds
  and the pages parse. After a checkout `App.tsx` bumps a `repositoryVersion`
  that every fetch of the repository depends on (log, branches, working tree,
  open commit), and `lib/repositoryChanges.ts` (app-only, a BroadcastChannel)
  tells the other tabs — an open `/working` tab refetches rather than showing a
  working tree that no longer exists.
  - The working-tree row is **barrel-level, not app-level** (ADR-0026 /
    ADR-0027): it is read on two surfaces — this shell and nightshift-ui's
    `<GitGraphPanel>` — so it lives in `components/` with the same
    href-or-handler open seam `CommitDetailPanel` offers (`href` for a host with
    a diff tab, `onOpen` for one that opens in-app; a handler-driven row renders
    a `<button>`, never a link with a dead href). It shipped app-local and so
    was silently absent from the host, which is the failure the barrel prevents.
    Its geometry helpers (`ROW_HEIGHT`, `GRAPH_NODE_COLUMN_X`,
    `graphContentLeft`) are exported from the barrel for the same reason — a
    host aligning a non-commit row must not guess an inset that drifts as lanes
    are added.
  - App-only chrome (localStorage-backed, deliberately kept out of the host
    barrel per ADR-0032): `lib/theme.ts` (`useTheme` + Zod-validated persisted
    mode, default `system`) with `ThemeToggle.tsx`, and `lib/detailLayout.ts`
    (`useDetailLayout`, default `inline`) with `DetailLayoutToggle.tsx`.
    `CommitDetailPanel` takes a `variant` (`inline` | `sidebar`) + `headerActions`
    seam (ADR-0027) and `CommitGraph` a `selectedDetail` inline slot that offsets
    the SVG for rows below the expansion; the layout algorithm is untouched. The
    variant drives the *frame*, never the body: both read metadata → message →
    changed files (ADR-0027 — the invariant is the detail, not the container),
    and only the sidebar's titled header differs, repeating the subject the
    inline variant leaves to the commit row above it.

The render layer is importable by subpath — `package.json` `exports` maps
`./components` (the fetch-free components, ref pill and git-action menu
included), `./shared` (schema + layout + ref grouping + fuzzy + the menu
descriptor),
`./highlighter` (`lib/highlighter.ts`), and `./theme.css`, so nightshift-ui can
source-alias them (no proxy, no forked copy).

## Dev commands

Via mise (`.mise.toml`): `dev` (port-resolving launcher, ADR-0037 §2),
`dev:ports` (probe/report only), `dev:server`, `dev:client`, `cli` (run `bgg`
from source), `build` (client + server + CLI), `start`, `typecheck`, `test`.
The standalone build/run also goes through the flake: `nix build` /
`nix run .# -- …`.

## Testing expectations

`bun test` must stay green. The layout algorithm is the risky part — its tests
cover branch tips, 2-parent merges, lane reuse after a branch closes, octopus
merges (3+ parents), root commits, disconnected histories, truncated windows,
plus a fixture pinned to the prototype's exact output. `server/services/git.test.ts`
exercises real git against a scratch repository (merge, tags, empty repo,
truncation, traversal rejection), including branch listing with default-branch
resolution and three-dot branch comparison (an unmerged fixture branch, since a
merged one correctly compares empty), plus the working tree (a `dirty-repo`
fixture with a modified, a deleted, an untracked text, and an untracked binary
file — list, clean, and per-file diffs including the `--no-index` untracked case
and the untracked-binary notice), plus the remote names the ref pills classify
against — three fixtures, because the reader has three ways to be wrong: a
`remotes-repo` (refs written with `update-ref`: `main` in sync with two remotes,
one remote-only branch, one local-only branch, grouped end to end from real
decorations, with `log.decorate=full` set in the fixture so the pinned
`--decorate=short` is what keeps them short), a `slash-remote-repo` (a remote
actually named `fork/alice`, which must be reported whole rather than cut at its
first slash, alongside a configured-but-unfetched remote that must not be
reported at all — one of them, `fork`, a hand-configured path prefix of
`fork/alice` that must not be admitted on the longer name's refs), and an
`ambiguous-remote-repo` (local branches colliding with remote-tracking refs, so
git's shortening prints `remotes/origin/main` and `heads/origin/main` — the
remote name must come back as `origin`, never as a forged remote called
`remotes`; the branch listing must say `origin/main`; and the default branch
must follow `origin/HEAD` to the colliding `trunk` rather than fall back to
`main`). The checkout route's service half runs against a fresh fixture per test
(a checkout changes the state the next would start from): branch, annotated tag
(and a tag sharing a branch's name, which must land on the tag), commit by full
and by abbreviated hash; every target the listings do not name refused *before*
git runs with HEAD untouched (unknown and remote-only branch names, a tag asked
for as a branch and vice versa, option- and revision-shaped names, a dangling
commit no ref reaches, a non-hex hash, a path-shaped repository id); and git's
refusal over uncommitted changes coming back with its stderr, the changes intact.
`services/mutation-guard.test.ts` pins each cross-origin check on its own plus
its composition on an Elysia route (refused before the handler, no CORS preflight
granted — `Sec-Fetch-Site` is pinned on the pure verdict because the test DOM's
Request drops `Sec-*` headers). `shared/gitActions.test.ts` pins the descriptor:
no entry ever missing, the reasons (already checked out, default branch, remote
only, HEAD already detached here, no full hash), the row/pill section order,
and the checkout statement's warnings. DOM tests cover `GitActionMenu`
(unwired handlers render disabled with a reason, a checkout is only *requested*,
links, the arrow/Home/End/Enter/Escape contract and that handled keys never reach
the host's shortcuts, copy via a stubbed Clipboard API), `ConfirmActionDialog`
(the statement before anything runs, stderr verbatim, buttons inert but focusable
while git runs), and `CommitGraph`'s context-menu seam (row vs pill request,
browser menu suppressed only over rows and pills and only when a handler is
wired, Shift+F10 / the context-menu key). The `git show`/`git diff` parsers
(`commitDetail.ts`, `fileDiff.ts`) and the route membership guards — path *and*
ref — are covered too, and client components have DOM tests (`bunfig.toml`
preloads happy-dom via `src/test/setup.ts`), including `MultiFileDiffView`'s
lazy load behind a stubbed IntersectionObserver, `CommitGraph`'s inline
`selectedDetail` slot, `UncommittedChangesRow`'s clean state and its two open
seams (link vs in-app handler), and `detailLayout`'s schema default/fallback (ADR-0029).
`CommitDetailPanel`'s message block is pinned on both variants: the block order
(metadata before message before files, asserted as document position, not as
text) and the message read back character for character against the message that
went in, so a lost blank line or a swallowed indent fails.
Ref grouping is covered on all three levels: `shared/refGroup.test.ts` for the
pure classifier and folding (synced branch, several remotes, diverged
branch/remote, remote-only, tag never folded, detached HEAD, slash-named
remotes, a no-remotes repository whose local `origin/main` must not read as
remote-tracking, a `remotes/…`-named local branch that must read as a branch
whatever the remotes are — including the case where its second segment *is* a
real remote, which is where the last stripping guess forged a sync onto a
sibling `feature` — a checked-out branch named like a remote ref, and a
comma-bearing tag name that must not forge a remote onto another branch), plus
`refGroupCopyValue`, whose job is that what reaches the clipboard always
resolves even where the pill's label is unqualified. Then
the same cases as pills on *both* rendering surfaces
(`CommitGraph`'s rows and `CommitDetailPanel`'s refs row, where the unified pill
must still offer exactly one compare affordance, and where the copy value is
read off a stubbed Clipboard API rather than a prop). Those pill tests pin the
*rendering* too: the remote segments (`.ref-segment-remote`) a unified pill
appends, the checked-out state class, that no surface prints `HEAD ->`, and
`CommitGraph`'s row ring — present and lane-coloured on the HEAD row, named in
its `aria-label`, absent on an unreferenced row and on a detached HEAD.
`RefPill.test.tsx` pins what makes the row cluster a unit at all: that the ring
lands in the same line as the pills and immediately before the first, that it
derives which branch it names, and that an undecorated commit renders nothing
rather than an empty box — the arrangement a re-placing surface would break
while still rendering both elements. The
standalone surface is
covered too: `services/port.test.ts` (probe/walk against real binds),
`listen.test.ts` (`strict|auto` strategy, announced skips, span exhaustion),
`bind-exposure.test.ts` (loopback-default / non-loopback-refusal, ADR-0037 §4),
`cli/args.test.ts` (argv routing + flag parsing), and `scripts/dev-ports.test.ts`
(env pinning + reassignment announcements).
Currently 287 tests across 22 files.

## UX conventions

- ADR-0019: fuzzy matches highlight the matched characters (`<mark>`).
- Ref pills: one pill per ref *identity*, not per `%d` decoration. A branch that
  agrees with its remotes names itself once and appends them as further segments
  of the same chip — `main │ origin`, divided by a hairline and set subordinate,
  with **no glyph between them**: containment already says "same ref", and the
  up/down arrow that used to sit there is git's own mark for *divergence*
  (`%(upstream:trackshort)` prints `=` in sync and keeps the two-direction form
  for a diverged branch), so it asserted the opposite of what the pill reports.
  A ref that exists on exactly one remote and nowhere locally keeps its qualified
  name (`origin/feature`) and gains no segments; a ref on *several* remotes and
  nowhere locally currently drops the qualifier and reads `shared │ origin │
  upstream`, which is an open question — it looks like a local branch and is told
  apart only by the remote colour and the tooltip. What is **copied** is settled
  regardless: `refGroupCopyValue` always hands over a ref that resolves
  (`origin/shared`), never the unqualified label. Pills only ever merge refs on
  the same commit, so a diverged branch and remote stay two legible pills; the
  tooltip always names the refs that went in, because a merged badge is a claim
  the reader has to be able to check. Ahead/behind counts would need
  `%(upstream:track)` and are deliberately absent — nothing in the pill implies a
  slot for them.
- The checked-out branch: **no `HEAD -> ` text** — that is raw `git log %d`
  plumbing, and none of Git Graph, GitLens/GitKraken or VS Code's Source Control
  Graph prints it. It reads as checked out two ways instead, both in
  `RefPill.tsx`: the pill keeps the head colour and adds weight plus a ring
  (`.ref-checked-out`), and `CommitRefRow` puts a small lane-coloured ring in
  the row *immediately* before the pills, naming the branch in its tooltip *and*
  its `aria-label`. That adjacency is the whole meaning — the ring says nothing
  on its own — which is why the cluster, not the ring, is the shared unit.
  That ring is never drawn on the SVG commit node — `CommitGraph`
  already rings the *selected* commit there, and a second ring would make
  "selected" and "checked out" the same shape. A detached HEAD is on no branch,
  so it leaves the row unmarked and speaks through its own `HEAD` pill.
- ADR-0025: disabled controls stay visible and explain themselves (`title`/placeholder).
- Git-action context menu (issue #2): right-click a commit row or ref pill, or
  Shift+F10 / the context-menu key on a focused row; the browser's menu is
  suppressed over exactly those targets. Arrows/Home/End move, Enter/Space
  invoke, Escape closes and returns focus to the row. Disabled entries stay
  focusable (`aria-disabled`) so their reason is reachable. A mutating entry only
  *requests* the action: the host shows `ConfirmActionDialog` with
  `describeCheckout`'s statement, runs git on confirm, and keeps git's stderr in
  the dialog on failure; success shows git's one-line report in a status strip
  and refetches. A detaching checkout (tag or commit) always carries the
  detached-HEAD warning. Remote-only refs offer checkout disabled-with-reason
  (tracking-branch creation is not in this slice).
- ADR-0016: no third-party runtime assets — everything is bundled.
- ADR-0022: Tabler vectors, never emoji.
- ADR-0018 / ADR-0037: dynamic port allocation runs in front of the strict bind
  (`auto` default, announced walk), never as a silent fallback; a conflict on a
  pinned port is still fatal. Loopback bind by default; non-loopback refuses
  without `GIT_GRAPH_ALLOWED_HOSTS`.
- ADR-0011 / ADR-0015: the `bgg` CLI resolves its sibling server bundle by real
  path, and its background daemon lives under the `daemon` subcommand.
- Theme: light/dark/system toggle in every shell's header (default `system`),
  persisted (ADR-0029) and applied via `[data-theme]`; a pre-paint shim in
  `index.html` avoids a flash.
- Commit detail (ADR-0031): opens inline beneath the selected row by default,
  with a persisted panel-header toggle back to the docked right sidebar.
- Commit detail order: metadata (commit · author · dates · parents · refs), then
  the commit message, then the changed files — the same in both variants. The
  identifying facts are short and scannable and read first; the message runs to
  whatever length it has below them. It is rendered **verbatim** — the title line
  included, blank lines and indentation preserved — because the commit row above
  can only show the subject `truncate`d, and before this the inline variant
  dropped the subject entirely, leaving a long one unreadable anywhere. The title
  line carries weight but is never re-wrapped or re-punctuated: the block's text
  is built as one string and sliced, so what renders is what git stored. The
  sidebar's header keeps the subject too; that repeat is accepted.
- Diff tabs (ADR-0031): a changed file, a whole commit, and a branch (against
  the default branch unless a base is chosen) each open in a standalone tab —
  via cmd/ctrl/middle-click on the file row, or the visible external-link /
  compare-branch controls on the row, the files-changed heading, and the branch
  ref pills. The controls stay visible and explain themselves per ADR-0025; the
  compare control appears only for local branches other than the default.
