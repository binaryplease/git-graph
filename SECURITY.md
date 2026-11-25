# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/binaryplease/git-graph/security)
2. Click **Report a vulnerability**

You will get an acknowledgement within 7 days. If a fix is warranted, we will
agree a disclosure timeline with you before publishing it, and credit you in the
release notes unless you ask us not to.

## Supported versions

This project is pre-1.0. Only the latest release on `main` receives fixes.

## Threat model — read this before reporting

`git-graph` is a **local-machine service with no authentication**. That is
the design, not an oversight, and the following are therefore *not*
vulnerabilities:

- **The API is unauthenticated.** Anything that can reach the port can read
  every repository under the served root — commit history, diffs, and
  working-tree contents. The loopback bind *is* the access control.
- **The served root is readable in full.** Listing and reading the git
  repositories under the configured root — or, with `GIT_GRAPH_REPOSITORIES_FILE`
  set, the repositories that file names — is the entire purpose of the program.
- **Whoever can write the repositories file decides what is served.** It is
  operator configuration, re-read on every request, exactly like the environment;
  keep it where only the operator (or the supervising host) can write it.
- **A configured embedding origin reads, checks out and merges like the git-graph
  page itself.** Naming an origin in `GIT_GRAPH_ALLOWED_ORIGINS` grants that page
  CORS reads and both writes; that is the point of the setting.
- **Repository hooks run on a write, by design.** A checkout runs
  `post-checkout`, and a merge runs `pre-merge-commit`, `prepare-commit-msg`,
  `commit-msg` and `post-merge`, as the same commands would in a terminal. Hooks
  come from `.git/hooks` or `core.hooksPath`, both local configuration the
  operator controls, so they are trusted like the rest of that configuration; a
  hook that refuses a merge leaves the repository restored (`git merge --abort`).

What **is** in scope:

- **Any escape from the served set** — reading a path, repository, or ref
  outside the served root, or outside the repositories file when one is set. A
  request can only name a member; any way for it to widen the set is in scope. Every untrusted input is re-validated by membership against git's
  own listings (repository ids against the repo listing, file paths against a
  commit's own file list, refs against `git for-each-ref`) before it reaches a
  subprocess. A way past any of those guards is a vulnerability.
- **Command or argument injection** into the `git` subprocesses.
- **Any way to bind a non-loopback address without the explicit
  `GIT_GRAPH_ALLOWED_HOSTS` acknowledgement**, or to defeat that gate.
- **Cross-site / browser-side attacks** that let a page you visit reach the
  local service and exfiltrate repository contents (e.g. DNS rebinding, a
  missing origin check). Every request is answered only for a loopback `Host`
  or a name in `GIT_GRAPH_ALLOWED_HOSTS` (the DNS-rebinding guard, issue #5), so
  a way to get an answer for any other name is in scope. CORS headers are
  granted only to an `Origin` that exactly equals an entry of
  `GIT_GRAPH_ALLOWED_ORIGINS` (none by default); a grant to any other origin is in
  scope.
- **Any write other than a confirmed checkout or merge.** `POST
  /api/git/checkout` and `POST /api/git/merge` are the only routes that change a
  repository, and neither pushes or fetches. Any other way to mutate a repository
  is a bug with security weight. So is any way to make the checkout act on a ref
  or commit git's own listings do not name, to make the merge bring in anything
  but a branch `for-each-ref refs/heads` lists, to make it run into a branch other
  than the one the request names as checked out, or to trigger either from a
  foreign web page. A merge that conflicts must be undone with `git merge
  --abort`; a way to leave a repository mid-merge while the response reports
  otherwise is in scope. Both writes require the `X-Git-Graph-Action: 1` header
  and a JSON body, and refuse a request the browser marks cross-site or whose
  `Origin` names a host the server does not answer for — unless that `Origin` is
  exactly one listed in `GIT_GRAPH_ALLOWED_ORIGINS`. A way around that gate is
  in scope.

## Deploying it beyond loopback

Binding a non-loopback address is a fatal startup error unless you set
`GIT_GRAPH_ALLOWED_HOSTS`. That variable also lists the only non-loopback names
the server answers for, so a proxy that passes its public host through in
`Host` must be named there even when git-graph binds loopback. It is an
acknowledgement, not a protection: if you set it, you are asserting that an authenticating reverse
proxy fronts the service and the port is not directly reachable. Exposing the
service without one publishes the full contents of every repository under the
served root to anyone who can reach it, and lets them check out refs and merge
branches in those repositories.
