# Contributing to binp-git-graph

Thanks for taking the time. This is a small, focused project — a local git
commit-graph viewer — and the fastest way to get a change merged is to keep it
that way.

## Before you start

- **Bugs and features:** open an issue first for anything that isn't a one-line
  fix. It's cheaper to agree on the shape than to review a finished PR that
  went the wrong way.
- **Security problems:** do *not* open an issue. Follow
  [`SECURITY.md`](SECURITY.md).
- **Architecture:** [`AGENTS.md`](AGENTS.md) is the project's real manual — the
  layering, the conventions, and why they are what they are. Read the section
  covering whatever you're touching before you touch it.

## Development setup

You need [Bun](https://bun.sh). [mise](https://mise.jdx.dev) is optional but
pins the toolchain version for you.

```sh
git clone https://github.com/binaryplease/binp-git-graph
cd binp-git-graph
mise install      # optional — installs the pinned Bun
bun install
mise run dev      # or: bun run dev
```

`dev` resolves free ports before launching (announcing any reassignment) and
starts the Elysia server plus the Vite dev client. `bun run dev:ports` reports
the resolved ports without starting anything.

Nix users can skip all of the above: `nix develop` gives you the toolchain, and
`nix run .#` builds and runs the CLI.

## The checks

All three must pass before a PR is reviewable:

```sh
bun test          # unit + DOM tests
bun run typecheck # tsc --noEmit
bun run build     # client + server + CLI bundles
```

## What a good change looks like

- **Match the surrounding code.** Comment density, naming, and idiom are part of
  the diff. A file that suddenly reads differently is harder to review than one
  that reads the same.
- **One concern per PR.** A refactor bundled with a feature gets both held up.
- **New behaviour arrives with a test.** The layout algorithm
  (`shared/graphLayout.ts`) is the risky part of this codebase and is pinned by
  a regression fixture — if you change what it outputs, you must update the
  fixture *deliberately* and say why in the PR.
- **Everything untrusted is re-validated by membership** against git's own
  listings before it reaches a subprocess — repository ids against the repo
  listing, file paths against a commit's own file list, refs against
  `git for-each-ref`. Nothing is interpolated into a shell. A change that
  weakens this will not be merged.
- **The render layer stays fetch-free.** Components under `src/components/`
  take data as props; the page shells own all fetching. This is what lets the
  graph be embedded elsewhere.
- **Icons are [Tabler](https://tabler.io/icons) vectors**, never Unicode
  characters or emoji.
- **Disabled controls stay visible and explain themselves** (via `title` or a
  placeholder) rather than disappearing.

## Commit messages

Conventional-commit prefixes (`feat:`, `fix:`, `refactor:`, `docs:`, `style:`,
`test:`, `chore:`), a lowercase imperative subject, and a body that says *why*
when the *what* isn't obvious from the diff.

## Licensing of contributions

By contributing, you agree that your contributions are licensed under the same
terms as the project — see the [`LICENSE`](LICENSE) file at the repository root.
There is no separate CLA to sign and no sign-off requirement.

## Code of Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
