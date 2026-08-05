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
    tabs/        the tab session: model.ts (order + groups), layout.ts (widths),
                 drag.ts (the gesture), schema.ts (what gets persisted)
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
  settings UI. Themes and the tab session are the deliberate exceptions — Rust stores both as opaque
  JSON so each schema lives in one place, the frontend. Reach for that exception only when the same
  three things hold as for themes: the shape is nested, the frontend already validates it, and Rust
  never reads inside it.
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

## Tabs

The reader keeps a set of documents open, in Chrome-style groups. Almost all of it is pure code in
`src/lib/tabs/`, which is where the tests are and where a change should start:

- **`model.ts`** owns the order. Its one hard invariant is that a group's tabs are a *contiguous*
  run, held by writing every mutator as remove-then-insert with a clamped seam — remove first and
  the run closes before any insertion maths happens, so a group with a hole in it is never
  representable. `normalize()` is the single repair point and is idempotent; it runs after every
  mutator and on load, which is the case that matters, since `config.json` is a file a user can
  edit. A file is never open in two tabs.
- **`layout.ts`** computes widths, because the drag maths needs exact geometry and an animated
  `width` gives the squeeze for free. Widths are integers with an explicit remainder pass — round
  each tab on its own and the total drifts, and the stray pixel lands on a different tab every time
  the `ResizeObserver` fires.
- **`drag.ts`** is the gesture as a pure reducer, so the state machine is testable without a DOM.
  Dragging only ever *reorders* — see below. Drop targeting compares against where the other tabs
  have already **slid to**, not their frozen positions: use the frozen ones and a swap needs a full
  tab-width of travel instead of half, and the tab visibly lags the pointer.

**Groups are made from the menu, not by dragging one tab onto another.** This was tried and
removed, so it is worth knowing why before trying again: lifting a tab lets its right-hand
neighbour slide into the slot just vacated, so *hovering the tab to my right* and *having not moved
at all* are the same pointer position. An overlap gesture cannot be told apart from an ordinary
drag; a travel guard that suppressed the false positives also made deliberate rightward grouping
unreachable, while leftward still worked — which is exactly the kind of bug that passes a test and
fails a person. Chrome has no tab-onto-tab grouping for the same reason. Dragging a tab *into* an
existing group's run does still join it, and that is ordinary reordering with a `join` intent.
- **`useTabs`** holds the session and persists it; **`useTabDocuments`** holds one document,
  history and scroll offset per tab. Tabs hydrate lazily — a restored ten-tab session opens one
  file, not ten, which also avoids ten `config.json` rewrites at startup (`open_document` records a
  recent on every call).
- **`DocumentDeck`** keeps background tabs mounted and hidden rather than unmounting them. This is
  the whole performance story: `enhance()` records what it has already done on the DOM nodes, so
  keeping them alive makes switching back nearly free.

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
- **The gap between two tabs is padding, never margin.** A margin between two `no-drag` elements in
  the titlebar is a live `drag-region` sliver, and a click landing in it moves the window instead of
  selecting a tab. For the same reason the tab track is `no-drag` as a whole, not tab by tab.
- **Never reparent a tab mid-drag** to raise it above its neighbours. Chromium fires
  `lostpointercapture` when a captured element leaves the document, which ends the gesture. Raise it
  with `z-index` on an isolated track instead.
- **Nothing in the drag waits on `transitionend`.** The global `prefers-reduced-motion` block forces
  every transition to 0.01ms, at which point that event fires unreliably or coalesces away. The
  model is committed synchronously on release; the animation is the DOM catching up.
- **`document.fonts.ready` before measuring chrome text.** A group pill sized from the fallback face
  is a few pixels narrow and truncates its own name, so `usePillWidths` measures twice.

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

**Two ways to test stale code, both of which look like a broken feature rather than a stale build:**

- **Vite's watcher does not see edits when the repo is a nested worktree** (`.claude/worktrees/…`).
  The server keeps serving the transform it built at startup, and reloading the page — even with
  `ignoreCache` — does not help, because the staleness is server-side. Restart `pnpm dev` after
  editing, or confirm what is actually being served with
  `curl -s http://localhost:1420/src/components/DocumentView.tsx | grep yourNewSymbol`.
- **`cargo test` does not rebuild the binary.** Run `cargo build` before relaunching, or the window
  is still running the previous Rust.

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
