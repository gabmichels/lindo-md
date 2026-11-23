#!/usr/bin/env bash
# Prepares a fresh lindo-md job worktree. cwd = the worktree. No secrets are needed.
set -euo pipefail
pnpm install --frozen-lockfile
