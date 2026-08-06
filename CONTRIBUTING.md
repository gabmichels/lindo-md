# Contributing

The working notes are in [AGENTS.md](AGENTS.md) and the visual rules in [DESIGN.md](DESIGN.md).
Both are written to be read before changing anything, and this file is the short version of
getting started plus the few things that will fail a PR if you have not seen them.

## Setup

```
pnpm install
pnpm tauri dev
```

Node ≥ 22.13, pnpm 11, a stable Rust toolchain, and on Windows WebView2. On Linux you also need
`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev` and `patchelf`.

`pnpm install` also points `core.hooksPath` at `.githooks/`, which is how the commit-message
check gets installed. There is no hook manager.

## Before you push

```
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm knip
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

CI runs all of these. **`cargo clippy` locally means exactly what it means in CI** — the lints are
declared in `Cargo.toml` rather than as CI flags — with one caveat: CI tracks stable Rust, so an
out-of-date local toolchain can report green where CI fails. `rustup update stable` first.

`pnpm test:e2e` drives the real app over CDP. It is not in CI and it needs a built binary and a
running dev server; see [`test/e2e/README.md`](test/e2e/README.md). Run it before a release, and
after touching rendering, the sanitizer, images or diagrams.

## The commit subject decides the release

This is the one thing most likely to catch you out. **The version number is derived from commit
types**, so the type is not decoration:

| Type | Effect |
| --- | --- |
| `feat:` | minor |
| `fix:`, `perf:` | patch |
| `feat!:`, or `BREAKING CHANGE:` in the body | major (a minor while pre-1.0) |
| `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `style:` | releases nothing, on purpose |

A behaviour fix labelled `chore:` ships to nobody. A `commit-msg` hook rejects a type the release
rules cannot read, and it shares its list with the release logic rather than restating it.

The body is where the reasoning goes — what you tried, what you rejected, what surprised you. The
history here is written to be read.

## What will be looked at in review

- **Tests are part of the change.** Every new pure function gets a unit test. Every new Markdown
  construct gets a case in `test/fixtures/kitchen-sink.md` and a Rust snapshot test. Anything
  touching the sanitizer gets a test proving the hostile input is neutralized.
- **A test that cannot fail is not a test.** If you are adding one for a bug, break the fix and
  watch it go red before you call it done. Several tests in this repo exist because that step
  found them checking nothing.
- **Comments explain why, not what.** And a comment that overstates what the code does is worse
  than none: three of the five defects found in this repo's security audit survived behind a
  document claiming something the code had stopped doing. If you change what the app does, change
  the paragraph that describes it in the same commit.
- **Tokens only.** No colour literal in a component, no hardcoded radius. Lint enforces both.
- **`aria-label` on every icon-only control.**

## Reporting a security problem

Not in an issue — see [SECURITY.md](SECURITY.md). A malicious document escaping the sanitizer,
reaching the network, or reaching the filesystem all belong in a private advisory.

## Reviews

Pull requests may get a comment from an AI reviewer as well as a human one; see
[docs/ai-review.md](docs/ai-review.md) for what that is and what it is not. It is advisory. The
checks that gate a merge are the ones in CI.
