#!/usr/bin/env node
/**
 * Stage the marketing site into `dist-site/`.
 *
 * The site is hand-written HTML, CSS and one ES module — there is nothing here
 * to compile, and a bundler for three files would be a build step that exists
 * to justify itself. What this does instead is *gather*: the screenshots live in
 * `docs/` because the README shows them, and the three fonts live in
 * `node_modules` because Fontsource ships them. Copying at publish time keeps
 * one copy of each in the repo.
 *
 * `pnpm site` then `pnpm site:serve` to look at it locally; the Pages workflow
 * runs the same script.
 */

import { cp, mkdir, rm, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repo, "dist-site");

/** Copied from `docs/`, which is where the README already points at them. */
const SHARED = [
  "icon.svg",
  "screenshot-light.png",
  "screenshot-dark.png",
  "screenshot-themes.png",
  "screenshot-notes-light.png",
  "screenshot-notes-dark.png",
];

/**
 * Latin only, and the `wght` axis rather than `opsz`.
 *
 * `scripts/fonts.mjs` makes the same two choices for the app and explains why at
 * length: Fontsource's package roots declare every subset Google ships, and a
 * page that pulls in Cyrillic to render an English landing page is paying for
 * scripts it cannot show.
 */
const FONTS = [
  "@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2",
  "@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2",
  "@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2",
  "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
];

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "fonts"), { recursive: true });

// The site's own sources, minus the drift test — it is checked in beside what it
// checks so the two move together, and it has no business being published.
for (const entry of await readdir(path.join(repo, "site"))) {
  if (entry.endsWith(".test.mjs")) continue;
  await cp(path.join(repo, "site", entry), path.join(out, entry), { recursive: true });
}

for (const name of SHARED) {
  await cp(path.join(repo, "docs", name), path.join(out, name));
}

for (const font of FONTS) {
  await cp(path.join(repo, "node_modules", font), path.join(out, "fonts", path.basename(font)));
}

// Pages runs the artifact through Jekyll unless told not to, and Jekyll drops
// every directory whose name starts with an underscore. Nothing here does today;
// the file costs nothing and removes a failure mode that presents as a 404.
await writeFile(path.join(out, ".nojekyll"), "");

console.log(`site staged → ${path.relative(repo, out)}`);
