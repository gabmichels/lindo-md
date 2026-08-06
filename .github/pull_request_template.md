<!--
  What changed and why. The commit messages in this repo carry the reasoning — the
  subject decides the version number, and the body is where the "why" lives — so a
  description that repeats the diff is less useful than one that says what you tried
  and rejected.
-->

## What this changes

## Why

## How it was checked

<!--
  Local gates: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and from
  `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test`. CI runs all of them, so this is about what CI *cannot* check —
  did you open the app and look at it?
-->

---

- [ ] The commit subject uses a type from the table in [CONTRIBUTING.md](../CONTRIBUTING.md).
      The version is derived from it, so `chore:` on a user-visible fix ships to nobody.
- [ ] New pure functions have unit tests; a new Markdown construct has a case in
      `test/fixtures/kitchen-sink.md`; anything touching the sanitizer has a test proving
      the hostile input is neutralized.
- [ ] If this changes what the app *does*, AGENTS.md says so. Three of the bugs found in
      this repo's audit survived because a document claimed something the code had stopped
      doing.
