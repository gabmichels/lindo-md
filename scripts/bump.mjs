/**
 * Bumps the app version in the two places that hold one.
 *
 * `package.json` is the source of truth — `src-tauri/tauri.conf.json` points at it, so bundle
 * filenames and the version shown in the app header both follow it automatically. `Cargo.toml`
 * carries its own copy because it is a crate manifest and cannot reference a JSON file; this
 * script keeps it in step, and `version.test.ts` fails the build if the two ever diverge.
 *
 *   node scripts/bump.mjs patch|minor|major
 *   node scripts/bump.mjs 1.2.3
 *
 * Deliberately does NOT commit or tag. Bumping and releasing are separate decisions — see
 * "Releasing" in AGENTS.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { bumpVersion } from "./version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/bump.mjs <patch|minor|major|X.Y.Z>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

// Shared with release.mjs so there is one implementation of what "minor" means, not two that
// can disagree.
const version = bumpVersion(current, arg);
if (version === current) {
  console.log(`already at ${version}; nothing to do`);
  process.exit(0);
}

// package.json — rewrite the field in place rather than re-serializing, so key order and
// formatting survive and the diff stays one line.
const pkgRaw = readFileSync(pkgPath, "utf8");
const pkgNext = pkgRaw.replace(/("version"\s*:\s*")[^"]+(")/, (_m, a, b) => `${a}${version}${b}`);
if (pkgNext === pkgRaw) throw new Error("could not find a version field in package.json");
writeFileSync(pkgPath, pkgNext);

// Cargo.toml — anchor to the [package] table's own `version`, not any dependency's.
const cargoRaw = readFileSync(cargoPath, "utf8");
const cargoNext = cargoRaw.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
  (_m, a, b) => `${a}${version}${b}`,
);
if (cargoNext === cargoRaw) throw new Error("could not find [package] version in Cargo.toml");
writeFileSync(cargoPath, cargoNext);

// Cargo.lock records the crate's own version too. Refresh just this package so the lock does not
// show up dirty on the next build; other dependencies are untouched.
try {
  execFileSync("cargo", ["update", "-p", "lindo-md", "--offline"], {
    cwd: join(root, "src-tauri"),
    stdio: "pipe",
  });
} catch {
  console.warn("note: could not refresh Cargo.lock — it will update on the next cargo build");
}

console.log(`${current} -> ${version}`);
console.log("package.json, src-tauri/Cargo.toml updated (tauri.conf.json follows package.json)");
console.log("\nNot committed or tagged — `pnpm release` does that, and normally calls this script");
console.log('itself rather than the other way round. See "Releasing" in AGENTS.md.');
