# AGENTS.md

Working notes for anyone — human or agent — changing this repo.

## What pretty-md is

A desktop Markdown **viewer**. It renders local `.md` files with editorial typography and full
GitHub-flavored support (tables, alerts, footnotes, math, highlighted code, Mermaid diagrams), and
lets the reader retheme the page in depth. It does not edit files. It never touches the network.

## Two invariants

Everything else in this document is derived from these.

1. **The webview is untrusted.** Markdown is arbitrary input from arbitrary files. The frontend gets
   no filesystem and no shell permission; reading, scanning, watching and exporting all happen behind
   allowlisted `#[tauri::command]` functions. `comrak` renders with `unsafe_` on (so `<details>` and
   `<kbd>` survive), which makes the `ammonia` pass afterwards **mandatory**, not optional.
2. **The tool and the paper are different materials.** `--ui-*` styles the tool and never changes;
   `--doc-*` styles the document and is rewritten on every theme switch. Neither side may read the
   other's tokens. See `DESIGN.md`.

## Setup

```
pnpm install
pnpm tauri dev
```

Requires Node ≥ 22, pnpm 10, a stable Rust toolchain, and (on Windows) WebView2, which ships with
Windows 11.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm tauri dev` | Run the app |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | vitest, once |
| `pnpm test:watch` | vitest, watching |
| `cargo test` | Rust unit tests (run from `src-tauri/`) |
| `cargo clippy --all-targets -- -D warnings` | Lint — CI treats warnings as errors |
| `cargo fmt --check` | Format check |
| `pnpm tauri build` | Bundle for the host platform |
| `pnpm bump <major\|minor\|patch>` | Sync the version across `package.json` and `Cargo.toml` |

All six gates run in CI on Linux, macOS and Windows. Run them locally before pushing.

## Layout

```
src/
  App.tsx  Specimen.tsx  styles.css      # styles.css owns every --ui-* token
  components/    chrome + document view; ui/ holds restyled Radix primitives
  hooks/         one concern each, colocated tests
  lib/
    ipc.ts       the ONLY place `invoke` is called; every response zod-parsed
    render/      post-render enhancement passes (shiki, mermaid, katex, links, images)
    theme/       Theme schema, presets, applyTheme, import/export
    export/      standalone HTML + print
src-tauri/src/
  lib.rs         builder wiring only; main.rs is 6 lines
  commands.rs    thin adapters — no logic
  markdown.rs    comrak + ammonia + TOC
  files.rs       open/read/scan/watch
  config.rs      settings persistence
  error.rs       PrettyError, serialized to the frontend as a plain string
```

Flat on purpose: no `features/`, no barrel `index.ts`. Tests sit next to the code they test —
`src/lib/theme/apply.test.ts`, and `#[cfg(test)] mod tests` at the bottom of each Rust module.

## Data flow

A command in `commands.rs` delegates to the module that owns the logic and returns
`PrettyResult<T>`. `PrettyError` serializes to a plain string, so error text is written for a reader,
not a log. On the TS side nothing calls `invoke` directly: `lib/ipc.ts` wraps every command, parses
the response with a zod schema, and attaches the command name to any parse failure. Rust structs use
`#[serde(rename_all = "camelCase")]`; Tauri converts argument names, so Rust `snake_case` parameters
are called with `camelCase` keys.

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- **Comments** explain *why*, not *what*. A comment restating the code is worse than no comment.
- **Tokens only.** No color literal in a component. No hardcoded radius — use `--ui-r-sm|md|lg`.
- **`aria-label` on every icon-only control.** The rail is almost all icon-only controls.
- **New setting?** It has to land in four places: the Rust struct in `config.rs`, the zod schema and
  TS type in `src/lib/ipc.ts` / `src/lib/types.ts`, and the settings UI. Themes are the deliberate
  exception — Rust stores them as opaque JSON so the schema lives in one place, the frontend.
- **Tests are part of the change, not a follow-up.** Every new pure function gets a unit test; every
  new Markdown construct gets a case in `test/fixtures/kitchen-sink.md` and a Rust snapshot test;
  every sanitizer-relevant change gets a test proving the hostile input is neutralized.

## Workflow

One worktree per change, via worktrunk:

```
git-wt switch --create feat/my-change
# ... work, `git-wt dev` for the dev server ...
git-wt merge
```

## Gotchas

- **The window is frameless** (`decorations: false`). `body` sets `user-select: none` because
  dragging the titlebar would otherwise start a text selection; the document canvas re-enables
  selection for itself. Window controls are drawn per-platform in one component, `TitleBar`.
- **The asset protocol is deny-all by default.** A directory is granted at runtime
  (`asset_protocol_scope().allow_directory()`) when the user opens a file or folder, so images
  resolve only inside documents the user actually opened.
- **Remote images are blocked by default** — an untrusted document should not be able to phone home
  through a tracking pixel. The setting is `blockRemoteImages`.
- **Shiki and Mermaid are large.** Both are dynamically imported so Vite code-splits them, and both
  run lazily behind an `IntersectionObserver`. Do not move either to a static import.
- **`pnpm tauri icon` rejects XML comments containing `--`.** The source mark is `docs/icon.svg`.
