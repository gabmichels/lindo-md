# lindo-md rules for factory agents

AGENTS.md and DESIGN.md are the source of truth; read the sections relevant to the change.
The rules that most often matter to a job:

- **The webview is untrusted.** Markdown/MDX/text are hostile input. The frontend gets no
  filesystem or shell permission; never widen `src-tauri/capabilities/` or the ammonia allowlist.
  Any sanitizer-relevant change needs a test proving hostile input is neutralized.
- **Tool vs paper tokens.** `--ui-*` styles the tool, `--doc-*` styles the document; neither side
  reads the other's tokens. No colour literals or hardcoded radii in components.
- **Conventional Commits are load-bearing**: the type decides the released version. `fix:` for a
  behaviour fix, `feat:` for a feature, `chore:`/`docs:`/`test:`/`refactor:` release nothing.
  The PR title is the squash commit on main and must follow the same rule.
- **Tests are part of the change.** New pure function -> unit test. New Markdown construct -> a case
  in `test/fixtures/kitchen-sink.md` + a Rust snapshot test.
- **New setting** lands in five places (AGENTS.md "Conventions"). New `Theme` field needs a zod default.
- **`config.json` is user data**: schema changes must degrade per element, never lose the file.
- **Dependencies are a decision**, not a reflex (AGENTS.md "Dependencies"); don't add one unless the spec says so.
- `aria-label` on every icon-only control.
- Verify with commands that exit; never run `pnpm tauri dev`, `pnpm dev` or watchers. Window chrome,
  installer and platform-API behaviour need a human on that platform; say so in the PR.
