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

## Run it anywhere (Nix)

The whole thing ships as a single on-demand CLI, `bgg`, packaged by the flake —
the deployed sibling of `binp-file-explorer`'s `bfe`:

```sh
nix run github:…/binp-git-graph            # serve the repos under the cwd, open the browser
nix run github:…/binp-git-graph -- ~/src   # serve a specific projects folder
nix run github:…/binp-git-graph -- daemon start   # keep one running in the background
```

`bgg` in a terminal serves the git repositories under the current directory (the
directory itself plus its direct children) and opens the graph in your browser.
Every instance auto-assigns a free port (ADR-0037), so any number run at once
without colliding; `--port <n>` pins one exactly and fails loudly on a conflict
(ADR-0018). `nix build` installs `bgg` and a spelled-out `binp-git-graph` alias.

Commands: `bgg [path]` · `bgg serve [path]` · `bgg daemon {start|stop|restart|status|logs}`
· `bgg status` · `bgg version` · `bgg help`.

The flake also exposes a hardened **NixOS module** (`nixosModules.default`,
`services.binp-git-graph`) that runs the server as a loopback-bound systemd
service — front it with an authenticating reverse proxy and set `allowedHosts`
before exposing it (see the security note below).

## Develop

```sh
mise install      # Bun toolchain
bun install       # dependencies
mise run dev      # resolve ports (ADR-0037 §2), then Elysia (:3010) + Vite (:5183)
```

`mise run dev` probes both canonical ports before launch, announces any
reassignment, and pins the result into both processes (so Vite's `/api` proxy
follows a moved server) — a stale session never forces manual port juggling, and
the runtime binds stay strict (ADR-0037). `mise run dev:ports` reports the
resolved ports without starting anything.

`mise run test` runs the unit tests (layout algorithm, parser, fuzzy matcher,
git service against a scratch repo, port allocation, bind-exposure, CLI parsing);
`mise run typecheck` type-checks; `mise run build` produces `dist/client` +
`dist/server` (server **and** the `bgg` CLI bundle); `mise run start` runs the
production server; `mise run cli` runs the `bgg` CLI from source.

## Serving repositories

The server scans a **served root** for git repositories — the root itself (if
it is one) plus its direct children — and runs `git log --all --topo-order`
in the one you select. The root defaults to `~/Developer`; point it elsewhere
with `GIT_GRAPH_ROOT` (see `.mise.toml`) or a positional argument:
`bun server/index.ts ~/projects`.
Only listed repositories are ever passed to git.

### Security model — loopback by default (ADR-0037 §4)

git-graph is an **unauthenticated** API: anything that can reach the port can
read every repository under the served root — commit history, diffs, and
working-tree changes. So the server binds `127.0.0.1` by default, and that
loopback bind is the access control. Binding a non-loopback address (`HOST=…`)
is a **fatal startup error** unless the operator names the served host(s) in
`GIT_GRAPH_ALLOWED_HOSTS` — the explicit acknowledgement that an authenticating
reverse proxy (e.g. Caddy) fronts the service and the port is not reachable
directly. There is no silent way to publish it.

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
