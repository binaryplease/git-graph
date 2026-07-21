# binp-git-graph

A **local git commit-graph viewer** — a web app that renders the commit DAG of
your repositories the way the proven desktop tools do (mhutchie/vscode-git-graph,
GitLens, GitKraken), as a standalone local-machine service.

Built from the prototype verified in
`mission-control-center/git-graph/index.html`: the lane-assignment algorithm is
pvigier's active-lane sweep, ported verbatim and pinned by unit tests. Per the
local-service-first strategy it runs standalone today and is structured so the
graph component can later be lifted into nightshift-ui as a module.

## Stack

Bun · Elysia · React 19 · Tailwind CSS v4 · Vite. Per **ADR-0003** (default
application tech stack). See [`AGENTS.md`](AGENTS.md) for the full breakdown and
conventions.

## Develop

```sh
mise install      # Bun toolchain
bun install       # dependencies
mise run dev      # Elysia (:3010) + Vite (:5183) — open http://localhost:5183
```

`mise run test` runs the unit tests (layout algorithm, parser, fuzzy matcher,
git service against a scratch repo); `mise run typecheck` type-checks;
`mise run build` produces `dist/client` + `dist/server`; `mise run start` runs
the production server.

## Serving repositories

The server scans a **served root** for git repositories — the root itself (if
it is one) plus its direct children — and runs `git log --all --topo-order`
in the one you select. The root defaults to `~/Developer`; point it elsewhere
with `GIT_GRAPH_ROOT` (see `.mise.toml`) or a positional argument:
`bun server/index.ts ~/projects`.
Only listed repositories are ever passed to git. This is a **local-only**
tool — the server binds to loopback and is not meant to be hosted.

## Status

Read-only viewer: repository picker (deep-linkable via `?repo=`), SVG commit
graph with per-lane colours, hollow merge nodes, curved elbow edges, ref pills
(HEAD / branch / remote / tag), fuzzy search over subject / hash / author with
matched-character highlighting, and a commits/lanes/matches readout. Selecting a
commit opens a detail panel — full message, changed files, copy-hash, clickable
parents — inline beneath the row by default (toggle to a docked sidebar), and
each changed file expands to an inline, whole-file-tokenized diff. A changed
file, a whole commit, and a branch (compared three-dot against the default) each
also open in a standalone diff tab. Light / dark / system theme toggle,
persisted. The render layer is importable by subpath (`binp-git-graph/components`,
`/shared`, `/theme.css`) for reuse in a host.
Planned: git actions from the UI (merge branch, checkout, …) and embedding the
graph component in nightshift-ui.
