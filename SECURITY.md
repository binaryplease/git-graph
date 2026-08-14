# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/binaryplease/binp-git-graph/security)
2. Click **Report a vulnerability**

You will get an acknowledgement within 7 days. If a fix is warranted, we will
agree a disclosure timeline with you before publishing it, and credit you in the
release notes unless you ask us not to.

## Supported versions

This project is pre-1.0. Only the latest release on `main` receives fixes.

## Threat model — read this before reporting

`binp-git-graph` is a **local-machine service with no authentication**. That is
the design, not an oversight, and the following are therefore *not*
vulnerabilities:

- **The API is unauthenticated.** Anything that can reach the port can read
  every repository under the served root — commit history, diffs, and
  working-tree contents. The loopback bind *is* the access control.
- **The served root is readable in full.** Listing and reading the git
  repositories under the configured root is the entire purpose of the program.

What **is** in scope:

- **Any escape from the served root** — reading a path, repository, or ref
  outside it. Every untrusted input is re-validated by membership against git's
  own listings (repository ids against the repo listing, file paths against a
  commit's own file list, refs against `git for-each-ref`) before it reaches a
  subprocess. A way past any of those guards is a vulnerability.
- **Command or argument injection** into the `git` subprocesses.
- **Any way to bind a non-loopback address without the explicit
  `GIT_GRAPH_ALLOWED_HOSTS` acknowledgement**, or to defeat that gate.
- **Cross-site / browser-side attacks** that let a page you visit reach the
  local service and exfiltrate repository contents (e.g. DNS rebinding, a
  missing origin check).
- **Anything that writes.** The service is read-only; a route that mutates a
  repository is a bug with security weight.

## Deploying it beyond loopback

Binding a non-loopback address is a fatal startup error unless you set
`GIT_GRAPH_ALLOWED_HOSTS`. That variable is an acknowledgement, not a
protection: if you set it, you are asserting that an authenticating reverse
proxy fronts the service and the port is not directly reachable. Exposing the
service without one publishes the full contents of every repository under the
served root to anyone who can reach it.
