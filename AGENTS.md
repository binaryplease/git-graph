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
| Styling | Tailwind CSS v4 | `@tailwindcss/vite` plugin; palette tokens in `src/index.css`. |
| Icons | `@tabler/icons-react` | ADR-0022 — never Unicode characters as icons. |
| Diff view | `@git-diff-view/react` + `@git-diff-view/shiki` | Pinned exactly at `0.1.7` (pre-1.0). Whole-file tokenization for inline commit diffs — beats per-line highlighting (diff2html). First substantial third-party runtime UI dependency; ADR still open (see `.nightshift/backlog.md`). |
| Build | Vite (client) + Bun bundler (server) | client → `dist/client/`, server → `dist/server/`. |
| Dev env | mise | `.mise.toml` declares tool versions, env vars, and tasks (ADR-0004). |

Dev ports are offset from binp-file-explorer so both run side by side:
Elysia **:3010**, Vite **:5183**.

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
  - `git.schema.ts` — the Zod-typed `git log` boundary (ADR-0013).
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
  - `fuzzy.ts` — subsequence fuzzy matcher with matched-character segments
    (ADR-0019).
- `server/` — Elysia service. `services/git.ts` scans the served root and
  shells out to git; repository identifiers are re-validated against the
  listing so arbitrary paths never reach the shell.
- `src/` — React client. `components/CommitGraph.tsx` is the reusable piece:
  commits in, SVG + rows out, no fetching, no app chrome. `CommitDetailPanel.tsx`
  (changed files, copy-hash, parent navigation) and `FileDiff.tsx` (inline
  disclosure per ADR-0031) are likewise fetch-free — `App.tsx`, the standalone
  shell (repo picker, search, readout, states, keyboard), owns all fetching.

## Dev commands

Via mise (`.mise.toml`): `dev`, `dev:server`, `dev:client`, `build`, `start`,
`typecheck`, `test`.

## Testing expectations

`bun test` must stay green. The layout algorithm is the risky part — its tests
cover branch tips, 2-parent merges, lane reuse after a branch closes, octopus
merges (3+ parents), root commits, disconnected histories, truncated windows,
plus a fixture pinned to the prototype's exact output. `server/services/git.test.ts`
exercises real git against a scratch repository (merge, tags, empty repo,
truncation, traversal rejection). The `git show` parsers (`commitDetail.ts`,
`fileDiff.ts`) and their route path-membership guards are covered too, and
client components have DOM tests (`bunfig.toml` preloads happy-dom via
`src/test/setup.ts`). Currently 73 tests across 7 files.

## UX conventions

- ADR-0019: fuzzy matches highlight the matched characters (`<mark>`).
- ADR-0025: disabled controls stay visible and explain themselves (`title`/placeholder).
- ADR-0016: no third-party runtime assets — everything is bundled.
- ADR-0022: Tabler vectors, never emoji.
- ADR-0018: port conflicts fail loudly at startup.
