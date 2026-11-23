#!/usr/bin/env bash
# lindo-md factory gate. Mirrors the CI "frontend" job, plus the Rust job when the change
# touches src-tauri/. Runs in the job worktree; exit 0 = PASS. Never launches the app.
set -euo pipefail
step() { echo; echo "::step:: $1"; }
BASE="${FACTORY_BASE:-origin/main}"

step commit-messages
# The release version is derived from commit types (AGENTS.md "Releasing"); check every job commit.
for sha in $(git rev-list "$BASE"..HEAD); do
  subject=$(git log -1 --format=%s "$sha")
  node --input-type=module -e "import { checkSubject } from './scripts/version.mjs'; const p = checkSubject(process.argv[1]); if (p) { console.error(p); process.exit(1); }" "$subject" \
    || { echo "Commit $sha has a subject the release rules cannot read: $subject"; exit 1; }
done

step tokens
# AGENTS.md: no colour literal in a component.
if git diff "$BASE"...HEAD -U0 -- 'src/components/**' 'src/hooks/**' 'src/App.tsx' \
   | grep -E '^\+' | grep -vE '^\+\+\+' | grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\("; then
  echo "New colour literal(s) in components. Use --ui-* / --doc-* tokens (DESIGN.md)."; exit 1
fi

step install;      pnpm install --frozen-lockfile
step typecheck;    pnpm typecheck
step format;       pnpm format:check
step lint;         pnpm lint
step knip;         pnpm knip
step test;         pnpm test
step build;        pnpm build

if git diff --name-only "$BASE"...HEAD | grep -q '^src-tauri/'; then
  command -v cargo >/dev/null || { echo "Change touches src-tauri/ but cargo is not installed here."; exit 1; }
  step rust-fmt;    (cd src-tauri && cargo fmt --check)
  step rust-clippy; (cd src-tauri && cargo clippy --all-targets -- -D warnings)
  step rust-test;   (cd src-tauri && cargo test)
fi

step clean-tree
git diff --quiet || { echo "The gate left tracked files modified:"; git status --short; exit 1; }
