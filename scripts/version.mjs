/**
 * The version rules, as pure functions: how a commit maps to a bump, and what the next release
 * is given where we are and what has landed. `release.mjs` is the I/O around this — git, files,
 * pushing — and keeping the decisions here is what makes them testable (`version.test.mjs`).
 *
 * The policy these encode is written up under "Releasing" in AGENTS.md. If you change a rule
 * here, change it there too; the doc is what humans read before trusting the number.
 */

/** `type(scope)!: subject` — the `!` is the Conventional Commits breaking-change marker. */
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s/;
const BREAKING_BODY = /^BREAKING[ -]CHANGE:/m;
const EXPLICIT_VERSION = /^\d+\.\d+\.\d+$/;

// Only these describe a change a user of the installed app can observe. Everything else — docs,
// chore, refactor, test, ci, style — is real work that changes no behaviour, and shipping an
// installer for it spends a download and a version number on an identical binary.
const MINOR_TYPES = new Set(["feat"]);
const PATCH_TYPES = new Set(["fix", "perf"]);

export const RANK = { patch: 1, minor: 2, major: 3 };

/** The bump a single commit asks for, or null if it asks for none. */
export function levelOf({ subject = "", body = "" }) {
  const match = HEADER.exec(subject);
  if (!match) return null; // Non-conventional subject: no-op, but reported so it stays visible.
  if (match.groups.breaking || BREAKING_BODY.test(body)) return "major";
  if (MINOR_TYPES.has(match.groups.type)) return "minor";
  if (PATCH_TYPES.has(match.groups.type)) return "patch";
  return null;
}

/** The highest level any single commit asks for: one `feat:` among twenty `fix:`es is a minor. */
export function deriveLevel(commits) {
  return commits.reduce((highest, commit) => {
    const level = levelOf(commit);
    if (!level) return highest;
    return !highest || RANK[level] > RANK[highest] ? level : highest;
  }, null);
}

export function bumpVersion(from, level) {
  if (EXPLICIT_VERSION.test(level)) return level;

  const [major, minor, patch] = from.split(".").map(Number);
  if ([major, minor, patch].some(Number.isNaN)) {
    throw new Error(`current version "${from}" is not X.Y.Z`);
  }
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`unknown bump "${level}" — use patch, minor, major, or an explicit X.Y.Z`);
  }
}

/**
 * What the next release should be. Returns `{ action: "none" }` when nothing user-visible has
 * landed, otherwise `{ action: "release", version, level, reason }`.
 *
 * `commits` is `{ subject, body }[]` since the last tag, newest first; `lastTag` is null before
 * anything has ever shipped; `override` is a level or an explicit X.Y.Z from the command line.
 */
export function planRelease({ current, lastTag, commits, override = null }) {
  if (override && EXPLICIT_VERSION.test(override)) {
    return {
      action: "release",
      version: override,
      level: null,
      reason: "explicit version on the command line",
    };
  }

  if (override) {
    if (!RANK[override]) {
      throw new Error(`unknown bump "${override}" — use patch, minor, major or X.Y.Z`);
    }
    return {
      action: "release",
      version: bumpVersion(current, override),
      level: override,
      reason: "level forced on the command line",
    };
  }

  if (!lastTag) {
    // Nothing has ever shipped, so the version in package.json has never been claimed by a
    // release. Ship *it* rather than bumping past a number no user has seen.
    return {
      action: "release",
      version: current,
      level: null,
      reason: "first release — tagging the current version rather than bumping past it",
    };
  }

  const level = deriveLevel(commits);
  if (!level) return { action: "none", reason: `no feat/fix/perf commits since ${lastTag}` };

  // Below 1.0 the app makes no stability promise, so a breaking change is a minor rather than a
  // 1.0.0 that would announce one. Declaring stability is a judgement about the product, not
  // something a commit message should be able to trigger by accident.
  if (level === "major" && current.startsWith("0.")) {
    return {
      action: "release",
      version: bumpVersion(current, "minor"),
      level: "minor",
      reason: "breaking change, but pre-1.0 — minor (run `pnpm release 1.0.0` to declare stable)",
    };
  }

  return {
    action: "release",
    version: bumpVersion(current, level),
    level,
    reason: `${level} — derived from ${commits.length} commit(s) since ${lastTag}`,
  };
}
