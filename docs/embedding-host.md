# Using git-graph's server as an embedding host's backend

Handover for the nightshift-ui builder (the follow-up to this slice). git-graph's
own server — `bgg`, or `server/index.ts` — can back an embedded graph: every read
the render layer needs, and the checkout write. The goal is that nightshift-ui
drops `server/git/graph.ts`, its hand-ported copy of the read layer. When it does,
git-graph issue #8 closes. Nothing here changes the render layer; this note only
covers the server contract.

## Launch configuration

Launch one git-graph server per host, as a supervised child process. The same
pattern as `server/fileExplorer.ts` works: loopback, `auto` port, and the ready
file.

| Variable | Value the host sets | Why |
|---|---|---|
| `GIT_GRAPH_REPOSITORIES_FILE` | Absolute path of a file the host owns, e.g. `$XDG_RUNTIME_DIR/nightshift-ui/git-graph-repositories` | The exact repositories served (see below). This replaces the root scan: `GIT_GRAPH_ROOT` and the positional root are then ignored. |
| `GIT_GRAPH_ALLOWED_ORIGINS` | Comma-separated exact origins of the host page, e.g. `http://127.0.0.1:3115,http://localhost:3115,http://127.0.0.1:3116,http://localhost:3116,http://127.0.0.1:5175,http://localhost:5175` | CORS reads and the cross-origin checkout for exactly these pages. Write each origin the way a browser sends it: scheme, host, and port, with no path and no trailing slash. `localhost` and `127.0.0.1` are different origins, so list both if the UI can be opened under either. A malformed entry makes the server exit at startup. |
| `HOST` | Leave unset (`127.0.0.1`) | Loopback only. The embedding seam does not change the bind (ADR-0037 §4). |
| `PORT` / `GIT_GRAPH_PORT_STRATEGY` | A canonical port with `auto`, or `strict` for an operator pin | The same as `bgg`. |
| `GIT_GRAPH_READY_FILE` | A private path | The server writes the port it bound there once it is listening. Read the port back from this file; do not parse stdout. |
| `NODE_ENV` | `production` when running the built `dist/server/index.js` | The same as `bgg`. |

Do **not** set `GIT_GRAPH_ALLOWED_HOSTS`. The host's browser calls
`http://127.0.0.1:<port>`, and the server already accepts a loopback `Host`.
Setting the variable would make the server also answer for another name, which
the embedding does not need.

`GET /api/status` reports `repositoriesFile` and `allowedOrigins`, so the
supervisor can confirm what the child is serving and for whom.

## Repository addressing

- **The file.** It holds one absolute path per line. Blank lines and lines
  starting with `#` are ignored. Write the repository **top level** (the
  directory that holds `.git`, as a file or a directory), not a subdirectory.
  The server re-reads the file on every request, so rewrite it whenever the
  project list changes; the server does not need a restart. Write it atomically
  (write a temp file, then rename it over the old one): a request that reads a
  half-written file fails instead of serving a partial set.
- **What is served.** Exactly the named paths that are git repositories right
  now. A named path that is not a repository is left out of the listing without
  an error, so the host can write its whole project list unfiltered. The listing
  also replaces nightshift-ui's `resolveRepoRoots`.
- **Fail-closed.** Startup fails if the file is missing, unreadable, or has a
  relative path on any line. If the file becomes unreadable or malformed while
  the server runs, every request fails with a 500, and nothing is served.
- **The identifier.** `GET /api/git/repos` returns
  `{ rootPath: null, repositories: [{ name, relativePath }] }`. In this mode
  `relativePath` is the **normalised absolute path**: `path.resolve` of the line,
  so no trailing slash and no `.`/`..` segments. Send that exact string as `repo`
  (a query parameter on reads, a body field on the checkout), URL-encoded as
  usual. The server matches it exactly, with no symlink resolution and no prefix
  matching. Any identifier that is not in the listing gets a 404, even if it
  names a real repository on disk.
- **Who controls the set.** Whoever can write the file decides what is served,
  just as whoever sets the environment does. Keep the file in a directory only
  the host's user can write.

## Request contract

Base URL: `http://127.0.0.1:<bound port>`. The full spec is at `/api/openapi.json`,
and the docs are at `/api/docs`.

**Reads.** Send plain `GET`s with no special headers. The browser adds
`Origin`. If the origin is listed, every `/api/*` response carries
`Access-Control-Allow-Origin: <that origin>` and `Vary: Origin`. That includes
error responses (a 404 for a repository outside the set, a 409 with git's
stderr), so the host can read the refusal and show it. The routes are the ones
the render layer already consumes:

| Route | Returns |
|---|---|
| `GET /api/git/repos` | The served set |
| `GET /api/git/log?repo=&limit=` | The `CommitLog` (commits, `remotes`, `truncated`) |
| `GET /api/git/commit?repo=&hash=` | The `CommitDetail` |
| `GET /api/git/diff?repo=&hash=&path=` | The `FileDiff` for one file of a commit |
| `GET /api/git/branches?repo=` | The `BranchList` (the default branch is flagged) |
| `GET /api/git/compare?repo=&head=&base=` / `…/compare/diff?…&path=` | A three-dot branch comparison, and one file of it |
| `GET /api/git/working?repo=` / `…/working/diff?repo=&path=` | Uncommitted changes against `HEAD`, and one file of them |

The payloads are the Zod schemas in `git-graph/shared` (`shared/git.schema.ts`).
Parse them with those same schemas.

**Checkout.** `POST /api/git/checkout` with:

- the header `X-Git-Graph-Action: 1` (`MUTATION_REQUEST_HEADER` /
  `MUTATION_REQUEST_HEADER_VALUE` from `shared/mutationRequest.ts`);
- the header `Content-Type: application/json`;
- the body `{ "repo": "<identifier>", "target": { "kind": "branch" | "tag", "name": "…" } | { "kind": "commit", "hash": "<full hash>" } }`
  (`CheckoutRequestSchema`).

Because the request has the custom header and a JSON body, the browser sends a
preflight first. The server answers the preflight with `204` and the CORS headers
(methods `GET, POST`; headers `content-type, x-git-graph-action`). It does this
only for a listed origin. The browser then sends the POST with
`Sec-Fetch-Site: same-site` (another port on the same host) or `cross-site`, and
the server accepts it only because `Origin` is listed. Do not send credentials
(`credentials: 'omit'`, the `fetch` default for cross-origin requests); the
server grants none.

Responses:

- `200` with `CheckoutResult` (`repository`, `head`, `branch`, and git's one-line
  `message`).
- `404` for an unknown repository, ref, or commit. Nothing ran.
- `409` when git refused, for example over uncommitted changes. `error` is git's
  stderr, verbatim. Show it in `ConfirmActionDialog`.
- `403` when the cross-origin gate refused. This means the origin is not listed,
  or the header or the JSON content type is missing.
- `421` when `Host` is not a name the server answers for. With the base URL
  above this should not happen.

Build the confirmation wording with `describeCheckout` (from `git-graph/shared`)
so the host's wording matches git-graph's own. After a `200`, refetch the log,
branches, working tree, and open commit, as `App.tsx` does.

## What stays refused

The host's configuration opens nothing else:

- An origin that is not listed gets no CORS headers, so its browser withholds
  the read. Its checkout gets a `403`, and its preflight is not granted.
- A foreign `Host` (DNS rebinding) gets a `421` on every route, before the CORS
  step runs, whatever the `Origin`.
- A repository that is not in the file gets a `404`, including a sibling of a
  listed one, a root-relative name, or a `..` traversal.
- A ref, tag, or commit that git's own listings do not name gets a `404` before
  git runs.

`server/index.test.ts` covers each of these end to end ("the embedding-host
configuration on the running server"), with the server launched as its own
process.
