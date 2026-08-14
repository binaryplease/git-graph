<!--
Security fix? Stop — do not open a public PR. See SECURITY.md.
-->

## What this changes

<!-- One or two sentences. Link the issue: "Closes #12" -->

## Why

<!-- The reason the change is worth making, if it isn't obvious from the above. -->

## Checks

- [ ] `bun test` passes
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] New behaviour has a test

## If you touched any of these, say so

- [ ] **`shared/graphLayout.ts`** — the layout algorithm's regression fixture is
      pinned to a known-good output. If the fixture changed, explain what
      behaviour changed and why the new output is correct.
- [ ] **Input validation** — anything reaching a `git` subprocess is still
      re-validated by membership against git's own listings.
- [ ] **`src/components/`** — the component stays fetch-free (data in via
      props), so an embedding host can still use it.
- [ ] **Bind or port behaviour** — the loopback default and the
      `GIT_GRAPH_ALLOWED_HOSTS` gate are unchanged.

## Screenshots

<!-- For any visual change, before and after. Light and dark theme if the
     change touches colour. -->
