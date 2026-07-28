# binp-git-graph — AGENTS.md

A **local git commit-graph viewer**: a standalone web service that lists the
git repositories at a served root and renders their commit DAGs. Sibling of
`binp-file-explorer` in shape and conventions (local-machine service-first;
later embeddable in nightshift-ui as a module).

## Project context — read `.nightshift/` first

Before starting any non-trivial task, consult `.nightshift/` — the local dev
notebook (gitignored) that is the single source of truth for plans, decisions,
and open questions. Record session outcomes back here — append to `log.md`,
update `backlog.md` — so the next agent inherits the context.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | Primary runtime; `Bun.spawn` runs git. |
| Server | Elysia | Per ADR-0003. |
| Validation | Zod (v4 API via `zod/v4`) | Boundary validation (ADR-0013). Route schemas use Zod, never TypeBox (ADR-0014); schemas double as the OpenAPI spec via `z.toJSONSchema`. |
| API docs | `@elysiajs/openapi` | ADR-0020: discovery at `GET /api`, Scalar UI at `GET /api/docs`, spec at `GET /api/openapi.json`. |
| Frontend | React 19 | |
| Styling | Tailwind CSS v4 | `@tailwindcss/vite` plugin; palette + lane tokens in `src/theme.css` (imported by `index.css`, shared verbatim with a host via `binp-git-graph/theme.css`, ADR-0027). Light/dark/system theme re-skins by overriding the same custom properties under `[data-theme="light"]`. |
| Icons | `@tabler/icons-react` | ADR-0022 — never Unicode characters as icons. |
| Diff view | `@git-diff-view/react` + `@git-diff-view/shiki` | Pinned exactly at `0.1.7` (pre-1.0). Whole-file tokenization for the diff views (inline unified in the panel, full-tab split for the standalone commit/compare tabs) — beats per-line highlighting (diff2html). First substantial third-party runtime UI dependency; ADR still open (see `.nightshift/backlog.md`). |
| Build | Vite (client) + Bun bundler (server + CLI) | client → `dist/client/`, server + `bgg` CLI → `dist/server/`. |
| Packaging | Nix flake | `flake.nix` → the `bgg` standalone CLI + `binp-git-graph` alias (`packages`/`apps`), a `devShell`, and a hardened `nixosModules.default` (`services.binp-git-graph`). Mirrors binp-file-explorer's `bfe` flake. |
| Dev env | mise | `.mise.toml` declares tool versions, env vars, and tasks (ADR-0004). |

Dev ports are offset from binp-file-explorer so both run side by side:
Elysia **:3010**, Vite **:5183**. These are the *canonical request*, not a pin:
`mise run dev` (→ `scripts/dev.ts`) resolves them before launch per **ADR-0037
§2** — probing each on the bind host, announcing any reassignment, and pinning
the result (`PORT`, `VITE_PORT`, `VITE_API_TARGET`, strategy `strict`) into both
child processes so a stale session never forces manual port juggling and Vite's
`/api` proxy follows a moved server. The runtime binds stay strict (ADR-0018).

## Derivation (ADR-0006)

Scaffolded per ADR-0003 with infra/dev-env conventions adopted from
**binp-file-explorer** (build scripts, ADR-0020 discovery skeleton, config
shape). The *product* is a port: the layout algorithm, renderer behaviour, and
search UX come verbatim from the prototype
`mission-control-center/git-graph/index.html` (commit 9f74265), which was
verified in-browser against real multi-branch history. Reference:
`mission-control-center/research/2026-06-18-git-graph-web-views.md`.

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
  - `gitLog.ts` — `git log` wire format + parser (unit separator `%x1f`).
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
- `server/` — Elysia service. `services/git.ts` scans the served root and
  shells out to git. Everything untrusted is re-validated by **membership**
  against git's own listings before it reaches the shell — repository
  identifiers against the repo listing, file paths against a commit's/
  comparison's own file list, and branch refs against `git for-each-ref`.
  Beyond the log/detail/file-diff routes it serves `GET /api/git/branches`
  (with default-branch resolution), `/api/git/compare` (branch-vs-base file
  list), `/api/git/compare/diff` (one file of a comparison), and
  `/api/git/working` + `/api/git/working/diff` (the working tree — uncommitted
  changes vs HEAD, and one file of it; tracked via `git diff HEAD`, untracked via
  `git ls-files --others` diffed from `/dev/null`, membership-guarded path).
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
  rendering piece is fetch-free — `CommitGraph.tsx` (commits in, SVG + rows
  out), `CommitDetailPanel.tsx` (changed files, copy-hash, parent navigation),
  `FileDiff.tsx` (one diff, unified or split by prop), `MultiFileDiffView.tsx`
  (file list on top + per-file diffs loaded lazily as each nears the viewport),
  plus shared tokens in `components/fileStatus.tsx` and chrome in
  `DiffTabFrame.tsx`. The shells (`App.tsx` and the four pages) own all
  fetching; `lib/diffRoutes.ts` is the single descriptor for the diff-tab URLs
  (ADR-0026) that the panel builds and the pages parse.
  - App-only chrome (localStorage-backed, deliberately kept out of the host
    barrel per ADR-0032): `lib/theme.ts` (`useTheme` + Zod-validated persisted
    mode, default `system`) with `ThemeToggle.tsx`, and `lib/detailLayout.ts`
    (`useDetailLayout`, default `inline`) with `DetailLayoutToggle.tsx`.
    `CommitDetailPanel` takes a `variant` (`inline` | `sidebar`) + `headerActions`
    seam (ADR-0027) and `CommitGraph` a `selectedDetail` inline slot that offsets
    the SVG for rows below the expansion; the layout algorithm is untouched.

The render layer is importable by subpath — `package.json` `exports` maps
`./components` (the fetch-free components), `./shared` (schema + layout + fuzzy),
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
and the untracked-binary notice). The `git show`/`git diff` parsers
(`commitDetail.ts`, `fileDiff.ts`) and the route membership guards — path *and*
ref — are covered too, and client components have DOM tests (`bunfig.toml`
preloads happy-dom via `src/test/setup.ts`), including `MultiFileDiffView`'s
lazy load behind a stubbed IntersectionObserver, `CommitGraph`'s inline
`selectedDetail` slot, and `detailLayout`'s schema default/fallback (ADR-0029). The standalone surface is
covered too: `services/port.test.ts` (probe/walk against real binds),
`listen.test.ts` (`strict|auto` strategy, announced skips, span exhaustion),
`bind-exposure.test.ts` (loopback-default / non-loopback-refusal, ADR-0037 §4),
`cli/args.test.ts` (argv routing + flag parsing), and `scripts/dev-ports.test.ts`
(env pinning + reassignment announcements).
Currently 164 tests across 15 files.

## UX conventions

- ADR-0019: fuzzy matches highlight the matched characters (`<mark>`).
- ADR-0025: disabled controls stay visible and explain themselves (`title`/placeholder).
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
- Diff tabs (ADR-0031): a changed file, a whole commit, and a branch (against
  the default branch unless a base is chosen) each open in a standalone tab —
  via cmd/ctrl/middle-click on the file row, or the visible external-link /
  compare-branch controls on the row, the files-changed heading, and the branch
  ref pills. The controls stay visible and explain themselves per ADR-0025; the
  compare control appears only for local branches other than the default.
