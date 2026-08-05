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
| `pnpm release` | Derive the next version from the commits, tag, push — see [Releasing](#releasing) |
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

- **Commits**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`). The type is
  load-bearing, not decoration — it decides the next version number. A behaviour fix labelled
  `chore:` ships to nobody. See [Releasing](#releasing).
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

Every change lands the same way — a branch, a pull request, a squash merge. How you *make* the branch
is up to you:

```
git switch --create fix/my-change main       # or: git-wt switch --create fix/my-change
# ... work, `pnpm tauri dev` for the app ...
git push -u origin fix/my-change
gh pr create
```

**Worktrunk is supported, not required.** `.config/wt.toml` is committed, so `git-wt switch --create`
and `git-wt dev` work for anyone who has [worktrunk](https://worktrunk.dev) installed — worth it when
several agents work in parallel. It is not installed by default and nothing here depends on it. Two
things to know before reaching for it: each worktree carries its own `node_modules` and
`src-tauri/target`, which is ~4.6 GB and a cold Rust build per branch, so it earns its keep on a
feature and not on a typo; and `devUrl` pins Vite to 1420, so only one worktree can run the desktop
app at a time — `git-wt dev` exists to start Vite alone on a per-branch port for frontend-only work.

**Do not use `git-wt merge`.** It squashes and fast-forwards into `main` locally, which skips the
pull request — and CI runs on pull requests *or* on a push to `main`, so the checks would land after
the code did. A failure then breaks trunk instead of blocking a PR. Whatever created the branch, land
it with `gh pr create`.

Run the six gates locally before pushing — see [Commands](#commands). CI runs the same six on Linux,
macOS and Windows plus a bundle build on each, but it never *launches* the app: a green tick means a
change compiles and packages on all three, not that it behaves on all three. Anything touching window
chrome, a platform API or the installer still wants a human on the platform in question. Prose-only
changes (`*.md`, `docs/**`, `LICENSE`) are skipped by `paths-ignore`, so a docs PR showing no checks
at all is working as intended.

**Pull requests are squash-merged.** That is what keeps `main` linear and one commit per change, and
it has two consequences worth knowing:

- The squash subject is the commit `main` gets, so it carries the Conventional Commit type and the PR
  number — `fix: give macOS back its window controls (#8)`. That subject is what
  [Releasing](#releasing) reads to derive the next version; the branch's own commits never reach
  `main` and are never consulted.
- Afterwards `git branch -d` refuses with *"not fully merged"*, because git cannot see a squashed
  commit as an ancestor of the branch it came from. This is expected, not a warning that work is
  about to be lost. Confirm the change really landed with `git diff <branch> main` — it should show
  only what *other* PRs added in the meantime — then delete with `-D`.

## Releasing

**Nobody picks a version number here.** `pnpm release` derives it from the Conventional Commits
since the last tag, so the decision is already made by the time you want to ship — it was made
one commit message at a time, by whoever knew what the change did.

```
pnpm release              # derive the bump, tag, push
pnpm release --dry-run    # show what it would ship, touch nothing
```

That is the whole workflow. `main` carries no version commits between releases; the bump, the
`chore(release): vX.Y.Z` commit and the annotated tag are all created at release time, and the
tag push is what `release.yml` waits for.

### What bumps what

| Commit since the last tag | Effect |
| --- | --- |
| `feat:` | minor — `0.3.1` → `0.4.0` |
| `fix:`, `perf:` | patch — `0.3.1` → `0.3.2` |
| `feat!:`, `BREAKING CHANGE:` in the body | major — but see the pre-1.0 rule below |
| `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `style:` | **nothing** |

The highest level any single commit asks for wins: one `feat:` among twenty `fix:`es is a minor.

Types that change no observable behaviour release nothing on purpose. A refactor is real work, but
shipping an installer for it spends a user's download and a version number on a binary that
behaves identically to the one they have. If a release is genuinely warranted anyway — a
dependency bump that closes a CVE, say — force it: `pnpm release patch`.

A non-conventional subject line counts as no-op rather than failing the release. `pnpm release`
lists everything it ignored, so a miscategorized commit is visible before the tag exists; check
that list rather than trusting the version.

### Two rules that only apply for a while

- **Pre-1.0, breaking changes are minors.** Below `1.0.0` the app makes no stability promise, so a
  `feat!:` moves `0.3.1` → `0.4.0`, not `1.0.0`. Declaring stability is a judgement about the
  product, not something a commit message should be able to trigger by accident — going 1.0 is
  therefore explicit and manual: `pnpm release 1.0.0`.
- **The first release ships the current number.** With no tags in the repo, `0.1.0` has never been
  published, so the first `pnpm release` tags `v0.1.0` as it stands instead of bumping past a
  version no user has seen.

### When to release

Whenever `main` has accumulated user-visible change worth downloading — there is no cadence to
keep and no ceremony to schedule. `pnpm release` refuses on a dirty tree, off `main`, or out of
sync with `origin`, and it runs `pnpm test` before tagging (`version.test.ts` is the check that
the bump reached both `package.json` and `Cargo.toml`). A tag is public and immutable; those
guards exist because everything they catch is trivial to fix before one exists and ugly after.

Releases are published as **drafts**. Building the installers is automatic; deciding they are fit
to hand to people is not — review the draft on GitHub and publish it yourself.

### The two version fields

`package.json` is the source of truth. `src-tauri/tauri.conf.json` points at it (`"version":
"../package.json"`), so bundle filenames and the in-app version follow automatically.
`src-tauri/Cargo.toml` needs its own copy because a crate manifest cannot reference JSON —
`pnpm bump` writes both and `version.test.ts` fails the build if they ever drift. Edit neither by
hand; `pnpm release` calls `pnpm bump` for you, and `pnpm bump <major|minor|patch>` on its own is
only for the rare case where you want the bump without the tag.

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

- **The window is frameless on Windows and Linux** (`decorations: false`), but **decorated on
  macOS**. `body` sets `user-select: none` because dragging the titlebar would otherwise start a text
  selection; the document canvas re-enables selection for itself. Controls are drawn per-platform in
  one component, `TitleBar`.
- **macOS keeps the real traffic lights, and that needs `decorations: true`.** `tao` builds the style
  mask without `NSWindowStyleMask::Titled` when decorations are off, and the buttons are subviews of
  the titlebar that mask creates — so an undecorated macOS window has *no* close, minimise or zoom at
  all. The macOS window therefore lives in its own `src-tauri/tauri.macos.conf.json`
  (`decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle` + `trafficLightPosition`).
  Tauri merges that file with **JSON Merge Patch (RFC 7396)**, which treats arrays as atomic, so it
  *replaces* `app.windows` wholesale rather than deep-merging into it: every property it fails to
  restate silently reverts to a Tauri default. `src-tauri/tests/window_config.rs` fails the build if
  the two files drift. `trafficLightPosition` with `decorations: false` does not merely look wrong —
  `tao` unwraps `standardWindowButton()`, which is `None` on a borderless window, and the app panics
  at launch.
- **A drag handle needs both the CSS class and the Tauri attribute** — use the `dragRegion()` helper
  in `src/lib/utils.ts` and never hand-write one. `app-region: drag` is a Chromium property, so it
  works in WebView2 and does nothing whatsoever in WKWebView; macOS moves the window only via
  `data-tauri-drag-region`. Verified by A/B: with the attribute removed the macOS titlebar is
  completely dead. The attribute applies only to the element it sits on and not to its children, so
  it needs no `no-drag` counterpart — but `no-drag` is still required for the Chromium side.
- **macOS hands over a double-clicked document by Apple Event, never in `argv`.** Finder sends
  `kAEOpenDocuments`, which Tauri surfaces as `RunEvent::Opened { urls }` — the only reason `lib.rs`
  uses `build()` + `run(|app, event| …)` instead of plain `run()`. Nor does the single-instance
  plugin cover it: macOS refuses to launch a second copy of a bundle and reactivates the running one
  instead, so that callback never fires there. With only the `argv` route wired up — how v1.0.0
  shipped — a double-clicked `.md` on macOS raised the window and opened nothing, which reads as the
  file association being broken rather than the app ignoring it. Windows and Linux do use `argv`, so
  all three routes have to stay live; they meet in `assoc::deliver`.
- **A hand-off can arrive before the frontend is listening, or long after.** A cold launch from
  Finder delivers the Apple Event before React mounts; a double-click into a running window delivers
  it seconds later. `assoc::OpenQueue` covers both by doing both — queue *and* `open-document` event
  — and the frontend drains the queue once on mount. Delivering the same path twice is deliberately
  harmless, since `tabs/model.ts` never opens one file in two tabs. The queue reads `argv` in
  `OpenQueue::from_launch` rather than from `setup`, because `setup` and the invoke handler run on
  different threads and a `setup` seed races the frontend's first call.
- **`dragDropEnabled` is on by default, so an HTML5 `ondrop` handler never fires.** The native side
  swallows the drag before the webview sees it. Tauri's own `onDragDropEvent` is the only route, and
  the only one that yields real filesystem paths instead of sandboxed `File` objects — see
  `useFileDrop`. Do not "fix" a dead drop target by adding `onDragOver`/`onDrop` to a div.
- **The asset protocol is deny-all by default.** A directory is granted at runtime
  (`asset_protocol_scope().allow_directory()`) when the user opens a file or folder, so images
  resolve only inside documents the user actually opened.
- **Remote images are blocked by default** — an untrusted document should not be able to phone home
  through a tracking pixel. The setting is `blockRemoteImages`.
- **In the opener plugin, the command grant and the URL scope are two separate permissions.**
  `opener:allow-open-url` enables `open_url` *with no scope*, and the `http`/`https`/`mailto`/`tel`
  globs live only in `opener:allow-default-urls`. Granting the first without the second makes
  `open_url` reject everything — which is how v1.0.0 shipped with every external link in every
  document dead. Nothing catches it at build time, so `lib.rs` asserts the pair in a unit test.
  The same split applies to `open_path`, which is why `links.ts` cannot simply be pointed at it:
  an unscoped path grant would turn `[x](../../../Windows/System32/calc.exe)` into one click.
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

### Verifying window chrome on macOS

WKWebView has no CDP, so none of the above applies. The chrome is window state rather than page
state, though, which means it can be checked from outside the app entirely:

```bash
# Do the traffic lights exist, and where are they? Empty output = the bug this
# section exists because of: an undecorated window has no buttons at all.
osascript -e 'tell application "System Events" to tell (first process whose name contains "lindo") \
  to get {subrole, position, size} of every button of front window'

screencapture -x -R<x>,<y>,<w>,<h> shot.png       # region from the window's own position/size
```

Dragging needs synthetic input, since `System Events` cannot drag: ~20 lines of Swift posting
`CGEvent` mouse-down / dragged / up against `.cghidEventTap` does it. **Reset the window position
before every trial** (`set position of front window to {400, 200}`) and compare against the expected
delta — measuring drags back to back, without resetting, produces deltas that match nothing and
invents bugs that are not there.

**`ps %cpu` on macOS is an average over the process lifetime, not current load.** A freshly launched
app reads 100%+ purely from its startup burst and looks like a spin loop. Use `top -l 2`, or
`sample <pid>` and check whether the main thread is parked in `mach_msg2_trap`.

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
