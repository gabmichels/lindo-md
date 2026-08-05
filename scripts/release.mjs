/**
 * Cuts a release: derives the next version from the commits since the last tag, bumps, commits,
 * tags and pushes. The tag push is what `.github/workflows/release.yml` waits for.
 *
 *   pnpm release              # derive the bump from Conventional Commits
 *   pnpm release --dry-run    # print what it would do, touch nothing
 *   pnpm release minor        # override the derived level
 *   pnpm release 1.0.0        # override the version outright
 *
 * The point is that nobody decides a version number by hand. `feat:` since the last tag means a
 * minor, `fix:` alone means a patch, and docs/chore/refactor-only stretches release nothing —
 * the commit messages already carry the decision, so re-asking a human for it only adds a way to
 * get it wrong. See "Releasing" in AGENTS.md for the policy this implements.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { levelOf, planRelease } from "./version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_BRANCH = "main";

const USAGE = `usage: pnpm release [patch|minor|major|X.Y.Z] [--dry-run] [--skip-checks] [--allow-branch]

  (no argument)   derive the bump from the Conventional Commits since the last tag
  --dry-run       print what it would ship; write and push nothing
  --skip-checks   skip \`pnpm test\` before tagging
  --allow-branch  release from a branch other than ${RELEASE_BRANCH}`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

// Unknown flags are rejected, not ignored: a typo'd `--dryrun` that silently fell through would
// tag and push for real, and a tag cannot be taken back once it is on origin.
const FLAGS = new Set(["--dry-run", "--skip-checks", "--allow-branch"]);
const unknown = argv.filter((a) => a.startsWith("-") && !FLAGS.has(a));
if (unknown.length) {
  console.error(`release: unknown option ${unknown.join(", ")}\n\n${USAGE}`);
  process.exit(1);
}

const dryRun = argv.includes("--dry-run");
const skipChecks = argv.includes("--skip-checks");
const allowBranch = argv.includes("--allow-branch");

const positional = argv.filter((a) => !a.startsWith("-"));
if (positional.length > 1) {
  console.error(`release: expected at most one version argument\n\n${USAGE}`);
  process.exit(1);
}
const override = positional[0] ?? null;

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

// No shell: a commit message like `chore(release): v0.2.0` contains parentheses, which cmd.exe
// treats as syntax — routing through a shell on Windows silently drops the quoting and commits
// something else. `shell` is opt-in for the one caller that needs it (pnpm is a .cmd shim).
function run(cmd, args, { shell = false } = {}) {
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell });
}

function die(message, hint) {
  console.error(`release: ${message}`);
  if (hint) console.error(`         ${hint}`);
  process.exit(1);
}

// --- Preconditions -------------------------------------------------------------------------
//
// Every one of these is recoverable *before* a tag exists and painful after: a tag is a public,
// immutable pointer, and the release workflow builds installers from whatever it names.

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== RELEASE_BRANCH && !allowBranch) {
  die(`on branch "${branch}", not ${RELEASE_BRANCH}`, "pass --allow-branch if that is deliberate");
}

if (git("status", "--porcelain")) {
  die("working tree is dirty", "commit or stash first — the bump has to be the only change");
}

// Fetch before comparing, or "up to date" only means "up to date with a stale remote ref".
try {
  execFileSync("git", ["fetch", "--quiet", "origin", RELEASE_BRANCH, "--tags"], { cwd: root });
  const local = git("rev-parse", "HEAD");
  const remote = git("rev-parse", `origin/${RELEASE_BRANCH}`);
  if (local !== remote) {
    const behind = git("rev-list", "--count", `HEAD..origin/${RELEASE_BRANCH}`) !== "0";
    die(
      behind ? "local branch is behind origin" : "local branch has unpushed commits",
      behind ? "git pull first" : "push them, let CI go green, then release",
    );
  }
} catch (err) {
  if (err?.status !== undefined && err.stdout === undefined) throw err;
  console.warn("release: could not reach origin; releasing against local state only");
}

// --- Where we are --------------------------------------------------------------------------

const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

let lastTag = null;
try {
  lastTag = git("describe", "--tags", "--abbrev=0", "--match", "v*");
} catch {
  // No tags yet — the first release is below.
}

const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const raw = git("log", range, "--no-merges", "--format=%H%x1f%s%x1f%b%x1e");
const commits = raw
  .split("\x1e")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [sha, subject, body = ""] = entry.split("\x1f");
    return { sha: sha.slice(0, 7), subject, body };
  })
  // A previous release commit carries no product change; counting it would let a re-run that
  // found nothing else still look releasable.
  .filter((c) => !c.subject.startsWith("chore(release)"));

// --- Deciding what to ship -----------------------------------------------------------------
//
// The rules themselves live in version.mjs, as pure functions with their own tests.

const classified = commits.map((c) => ({ ...c, level: levelOf(c) }));

let plan;
try {
  plan = planRelease({ current, lastTag, commits, override });
} catch (err) {
  die(err.message);
}

if (plan.action === "none") {
  console.log(`Nothing to release: ${plan.reason}.`);
  if (commits.length) {
    console.log(`\n${commits.length} commit(s) in range, none of them user-visible:`);
    for (const c of classified) console.log(`  ${c.sha}  ${c.subject}`);
    console.log("\nRelease anyway with an explicit level, e.g. `pnpm release patch`.");
  }
  process.exit(0);
}

const { version, reason } = plan;

// --- Report --------------------------------------------------------------------------------

const notes = classified.filter((c) => c.level);
const ignored = classified.filter((c) => !c.level);

console.log(`\n  ${current}  ->  ${version}`);
console.log(`  ${reason}\n`);

if (notes.length) {
  console.log("User-visible since " + (lastTag ?? "the start of history") + ":");
  for (const c of notes) console.log(`  ${c.level.padEnd(5)}  ${c.sha}  ${c.subject}`);
}
if (ignored.length) {
  console.log(`\nNot counted (${ignored.length}):`);
  for (const c of ignored) console.log(`         ${c.sha}  ${c.subject}`);
}

if (dryRun) {
  console.log("\n--dry-run: nothing written, nothing pushed.");
  process.exit(0);
}

// --- Do it ---------------------------------------------------------------------------------

const tag = `v${version}`;
if (git("tag", "--list", tag)) die(`tag ${tag} already exists`, "pass an explicit later version");

if (version !== current) {
  console.log(`\nBumping to ${version}...`);
  run("node", ["scripts/bump.mjs", version]);
}

// vitest carries version.test.ts, which fails if the bump left package.json and Cargo.toml
// disagreeing — so this both guards the release and proves the bump landed in both files.
if (!skipChecks) {
  console.log("\nRunning tests before tagging...");
  run("pnpm", ["test"], { shell: true });
}

if (git("status", "--porcelain")) {
  run("git", ["add", "package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
  run("git", ["commit", "-m", `chore(release): ${tag}`]);
}

// Annotated, not lightweight: the tag carries the release's own summary, so `git show v0.2.0`
// explains what shipped without a changelog file to maintain.
const message = [`lindo-md ${tag}`, "", ...notes.map((c) => `- ${c.subject}`)].join("\n");
run("git", ["tag", "-a", tag, "-m", message]);

// --follow-tags pushes the branch and the annotated tag in one go, so there is no window where
// main claims a version that has no tag.
run("git", ["push", "--follow-tags", "origin", RELEASE_BRANCH]);

console.log(`\n${tag} pushed. release.yml is building the installers.`);
console.log("It publishes a *draft* release — review it on GitHub, then hit publish.");
console.log(`  https://github.com/gabmichels/lindo-md/releases`);
