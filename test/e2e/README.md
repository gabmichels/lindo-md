# Smoke tests against the running app

Six checks driven over the Chrome DevTools Protocol, against a real window with a real
document open. They cover the things no unit test can reach — chiefly **whether anything
leaves the process**, which is the claim on the README and the one two separate bugs have
broken.

## Running them

Three terminals' worth of setup, because the app needs its dev server and the harness
needs the debugging port.

```bash
# 1. the dev server the debug build loads from
pnpm dev

# 2. build the binary, if you have not lately
cd src-tauri && cargo build

# 3. launch with the debugging port, opening the fixture
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" \
  ./src-tauri/target/debug/lindo-md.exe test/e2e/fixtures/e2e-smoke.md

# 4. and measure
pnpm test:e2e
```

On macOS and Linux the environment variable is ignored; pass `--remote-debugging-port=9222`
to the binary instead.

## Why it is not in CI

It needs a real windowing environment and a built binary, which is a GUI runner and a
Tauri build for every run. That is a large amount of CI time for six checks, and a
headless X server changes exactly the rendering behaviour some of them measure.

So it is a command you run **before cutting a release**, and after touching the render
pipeline, the sanitizer, or anything to do with images or diagrams.

Calling that out rather than wiring it into `ci.yml` and letting it rot: a suite that
only runs when someone remembers is honest about what it is. One that is in CI but
skipped, quarantined or flaky is worse, because it looks like coverage.

## If the first check fails

It will tell you which tabs it found instead. Two causes, both seen while writing this:

- **The binary is stale.** How a document handed over on the command line reaches the app
  changed in "accept documents the OS hands over, by every route it uses"; a binary built
  before that ignores the argument and simply restores its last session. `cargo build`
  before launching.
- **The session was restored over it.** The app reopens the tabs you had. Once the fixture
  has been opened once it stays in the session, so this is a first-run problem.

The check exists precisely because both of those look like a passing test otherwise. An
earlier version of this harness reported "nothing reaches the network" as a PASS while
measuring an entirely different document.

## What it cannot do

**Native dialogs.** Open, Save and Export all go through the OS file picker, which CDP
cannot see or drive. Everything behind them — importing a theme, exporting HTML, the
`open_path` branch of link handling — is out of reach here and is covered by unit tests
on the pure parts instead.

**A clean session.** The app restores its tabs, so the fixture is not necessarily the
active document on launch. The first check finds and activates its tab, and fails loudly
if it is not open at all rather than silently measuring whatever else was on screen —
which is a mistake that was actually made while developing this.

## Why CDP at all

The window is a WebView2 with no automation surface. `SendKeys` does not reach it and
there is no WebDriver, so remote debugging is what is left. It has earned its place: it
is how the Mermaid egress bug was confirmed, and how an audit's claim that
`blockRemoteImages` was broken was refuted. In both cases the evidence was the network
trace, and there was no other way to get it.
