# AGENTS.md

Working notes for anyone — human or agent — changing this repo.

## What lindo-md is

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
  defaults.rs    which app owns .md (read-only — Windows blocks writing it)
  error.rs       LindoError, serialized to the frontend as a plain string
```

Flat on purpose: no `features/`, no barrel `index.ts`. Tests sit next to the code they test —
`src/lib/theme/apply.test.ts`, and `#[cfg(test)] mod tests` at the bottom of each Rust module.

## Data flow

A command in `commands.rs` delegates to the module that owns the logic and returns
`LindoResult<T>`. `LindoError` serializes to a plain string, so error text is written for a reader,
not a log. On the TS side nothing calls `invoke` directly: `lib/ipc.ts` wraps every command, parses
the response with a zod schema, and attaches the command name to any parse failure. Rust structs use
`#[serde(rename_all = "camelCase")]`; Tauri converts argument names, so Rust `snake_case` parameters
are called with `camelCase` keys.

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- **Comments** explain *why*, not *what*. A comment restating the code is worse than no comment.
- **Tokens only.** No color literal in a component. No hardcoded radius — use `--ui-r-sm|md|lg`.
- **`aria-label` on every icon-only control.** The rail is almost all icon-only controls.
- **New setting?** It has to land in five places: the Rust struct in `config.rs`, the zod schema and
  TS type in `src/lib/ipc.ts` / `src/lib/types.ts`, the `FALLBACK` in `hooks/useConfig.tsx`, and the
  settings UI. Themes are the deliberate exception — Rust stores them as opaque JSON so the schema
  lives in one place, the frontend.
- **Which settings surface?** `SettingsDrawer` is for anything you can watch change in the document
  behind it — themes, type, colour, spacing. Everything else goes in `SettingsDialog`. The drawer is
  non-modal and scrimless *because* it is a live preview; putting a behaviour toggle in it borrows
  that shape for a control that has nothing to preview.
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
- **Mermaid cannot parse `oklch()`** — it throws `Unsupported color format` and the diagram fails.
  Every colour handed to it goes through `toHex` in `src/lib/theme/color.ts` first. The same applies
  to `<input type="color">`, which only accepts `#rrggbb`.
- **Mermaid sizes each label box from a DOM text measurement.** It has to be measured in the same
  type context the SVG renders in, in an element that is attached and laid out — see
  `measuringHost` in `src/lib/render/mermaid.ts`. `display: none`, `height: 0` or a different
  font-size all produce boxes too small for their text. Its flowchart viewBox is unreliable
  regardless, so `normalizeViewBox` recomputes it from the drawn geometry.
- **Do not set `scrollbar-width` or `scrollbar-color` next to `::-webkit-scrollbar` rules.**
  Chromium ignores the `::-webkit-` rules entirely if the standard properties are present, and the
  OS scrollbar comes back.

## Driving the running app

The window is a WebView2 with no automation surface, and `SendKeys` does not reach it. Launch with
remote debugging and drive it over CDP instead — this is how the rendering was verified:

```bash
pnpm dev &                                   # the app needs the dev server at :1420
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"   ./src-tauri/target/debug/lindo-md.exe test/fixtures/kitchen-sink.md
curl -s http://127.0.0.1:9222/json           # find the page target
```

From there `Runtime.evaluate` scrolls or clicks and `Page.captureScreenshot` captures the result.
Passing a path on the command line works because of the file-association handling in `assoc.rs`, so
no dialog has to be driven to open a document.

## Windows packaging

- **`bundle.publisher` must be set explicitly.** Without it Tauri derives the publisher from the
  second segment of the identifier, so `io.github.gabmichels.lindomd` showed up in Apps & Features
  as published by "github".
- **`fileAssociations[].name` becomes the Windows ProgID**, so it has to be unique to this app —
  `LindoMd.Markdown`, not a generic `Markdown Document` that another Markdown viewer could also
  claim and overwrite. `description` is what Explorer shows in the Type column.
- **Registering the association does not steal the default handler.** Windows honours
  `HKCU\...\Explorer\FileExts\.md\UserChoice` above `HKCU\Software\Classes\.md`, so a user who has
  already chosen an editor keeps it and lindo-md appears under "Open with". Do not try to override
  `UserChoice` — it is hash-protected (enforced by UCPD.sys since KB5034765), and doing so is what
  malware does.
- **`installer-hooks.nsh` adds what Tauri's bundled `FileAssociation.nsh` leaves out**: an
  `OpenWithProgids` entry per extension, a `Capabilities` key, and a `RegisteredApplications` value.
  Without that last pair lindo-md does not appear in Settings → Default apps at all, and the
  `ms-settings:defaultapps?registeredAppUser=lindo-md` deep link in `defaults.rs` has nothing to
  resolve to. Three names have to agree across three files — the ProgID (`tauri.conf.json` /
  `installer-hooks.nsh` / `defaults.rs`) and the registered-app name (`installer-hooks.nsh` /
  `defaults.rs`); each is commented on both sides.
- **The default-app row cannot be verified from `tauri dev`.** A dev build was never run through the
  installer, so it is not registered and the deep link falls back to the generic Settings page.
  Reading the current handler works either way; the deep link needs `pnpm tauri build` and an
  install.
