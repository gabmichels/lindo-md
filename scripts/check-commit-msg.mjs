/**
 * The `commit-msg` hook: refuses a subject line the release rules cannot read.
 *
 * The version number here is *derived* from commit types, so a subject line is not
 * cosmetic — it is the input to what ships. `fixx: crash on open` is a valid commit
 * message to git, means nothing to `deriveLevel`, and quietly releases nothing. Today
 * the only thing standing between that and a wrong version is someone reading the
 * ignored-commits list that `pnpm release` prints.
 *
 * It shares `checkSubject` with the release logic rather than restating the rules,
 * because two copies of a policy is exactly how the policy stops being one policy.
 *
 * No dependency and no hook manager: `prepare` points `core.hooksPath` at `.githooks/`,
 * which is committed. One less package with an install script, and the hooks are visible
 * in the tree instead of generated into `.git/`.
 */
import { readFileSync } from "node:fs";

import { checkSubject } from "./version.mjs";

const path = process.argv[2];
if (!path) {
  console.error("check-commit-msg: expected a path to the commit message file");
  process.exit(1);
}

const [subject = ""] = readFileSync(path, "utf8").split("\n");
const problem = checkSubject(subject);
if (!problem) process.exit(0);

console.error(`
  ✗ ${problem}

  The version is derived from these, so the type decides what ships:

      feat:              a minor      0.3.1 -> 0.4.0
      fix: / perf:       a patch      0.3.1 -> 0.3.2
      feat!: / BREAKING CHANGE: in the body    a major
      docs: chore: refactor: test: ci: style:  release nothing, on purpose

  A type this hook does not know releases nothing at all, which is the failure it
  exists to prevent — see "Releasing" in AGENTS.md.
`);
process.exit(1);
