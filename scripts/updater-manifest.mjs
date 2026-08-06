/**
 * Builds the `latest.json` the in-app updater reads.
 *
 * `tauri-action` can write this file itself, and for a single-runner release it should.
 * This repo builds on two runners, and the action writes the manifest from the artifacts
 * of *its own* job — so Windows publishes a `latest.json` describing only Windows, Linux
 * publishes one describing only Linux, and whichever finishes last overwrites the other.
 * Half the users then check for updates and are told, by a well-formed manifest served
 * from the right URL, that their platform has no release. Nothing errors. It is the same
 * shape of failure the checksum step downstairs already documents: a step that appears to
 * have succeeded while silently dropping an artifact.
 *
 * So both jobs are told not to write it (`uploadUpdaterJson: false`) and a third job runs
 * this over the finished release instead, where every platform's artifacts exist at once.
 *
 *   node scripts/updater-manifest.mjs --dir <assets> --version 1.2.0 --tag v1.2.0 \
 *     --repo owner/name [--notes "..."] [--pub-date 2026-08-06T00:00:00Z]
 *
 * Prints the manifest to stdout. The `--pub-date` is passed in rather than read from the
 * clock so a re-run produces the same bytes.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Which release asset serves which platform key.
 *
 * `target` is what `tauri-plugin-updater` sends as the platform half of the key; the
 * arch half is fixed at `x86_64` because that is the only architecture `release.yml`
 * builds. Adding an arm64 runner means adding entries here, and the "every platform
 * accounted for" check below will say so rather than quietly shipping a manifest that
 * omits it.
 *
 * The matcher is deliberately narrow. `endsWith(".exe")` would also match a future
 * portable build, and an updater pointed at the wrong binary is worse than one pointed
 * at nothing: it installs.
 */
const PLATFORMS = [
  { key: "windows-x86_64", matches: (name) => name.endsWith("-setup.exe") },
  { key: "linux-x86_64", matches: (name) => name.endsWith(".AppImage") },
];

/**
 * Assembles the manifest from a list of `{ name, signature }` assets.
 *
 * Pure, and separated from the filesystem, because the part worth testing is the
 * matching: which asset becomes which platform, and what happens when one is missing or
 * two match the same key.
 *
 * @param {{version: string, tag: string, repo: string, notes: string, pubDate: string,
 *          assets: {name: string, signature: string}[]}} input
 */
export function buildManifest({ version, tag, repo, notes, pubDate, assets }) {
  const platforms = {};

  for (const { key, matches } of PLATFORMS) {
    const found = assets.filter((asset) => matches(asset.name));

    // A release with no bundle for a platform is a broken release, not a manifest with a
    // gap in it — every run of `release.yml` builds both. Failing here is the only way
    // that gets noticed before someone's update check silently finds nothing.
    if (found.length === 0) {
      throw new Error(`no updater artifact matched ${key}; the release is incomplete`);
    }
    // Two matches means the guess above stopped being unambiguous — a second installer
    // flavour, an arch suffix. Picking one would be a coin flip over what gets installed.
    if (found.length > 1) {
      throw new Error(
        `${found.length} assets matched ${key} (${found.map((a) => a.name).join(", ")}); ` +
          "narrow the matcher in scripts/updater-manifest.mjs",
      );
    }

    const [asset] = found;
    if (!asset.signature.trim()) {
      throw new Error(`${asset.name} has an empty signature; it was not signed`);
    }

    platforms[key] = {
      signature: asset.signature.trim(),
      // Pinned to the tag rather than to `/releases/latest/`: `latest` follows whatever
      // is newest at request time, so a manifest fetched during the next release could
      // hand out a URL that has already moved on to a different version than the one it
      // just promised — and the signature it carries would then not match the file.
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(asset.name)}`,
    };
  }

  return { version, notes, pub_date: pubDate, platforms };
}

/** Pairs each updater artifact in `dir` with the `.sig` written beside it. */
export function readAssets(dir) {
  const names = readdirSync(dir);
  const signatures = new Set(names.filter((name) => name.endsWith(".sig")));

  return names
    .filter((name) => !name.endsWith(".sig"))
    .filter((name) => signatures.has(`${name}.sig`))
    .map((name) => ({
      name,
      signature: readFileSync(join(dir, `${name}.sig`), "utf8"),
    }));
}

function main(argv) {
  const flag = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };

  const dir = flag("dir");
  const version = flag("version");
  const tag = flag("tag");
  const repo = flag("repo");
  if (!dir || !version || !tag || !repo) {
    console.error(
      "usage: updater-manifest.mjs --dir <assets> --version <x.y.z> --tag <vX.Y.Z> --repo <owner/name> [--notes <text>] [--pub-date <iso>]",
    );
    process.exit(1);
  }

  let manifest;
  try {
    manifest = buildManifest({
      version,
      tag,
      repo,
      notes: flag("notes") ?? `lindo-md ${version}`,
      pubDate: flag("pub-date") ?? new Date().toISOString(),
      assets: readAssets(dir),
    });
  } catch (error) {
    // An annotation and one line, rather than a stack trace: every throw above is a
    // statement about the release, and the person reading this log wants to know which
    // artifact is missing, not which line of this file noticed.
    console.error(`::error::updater manifest: ${error.message}`);
    console.error(`assets considered in ${dir}:`);
    for (const asset of readAssets(dir)) console.error(`  ${asset.name}`);
    process.exit(1);
  }

  console.log(JSON.stringify(manifest, null, 2));
}

// Only when run directly, so the test can import the pure half.
if (process.argv[1]?.endsWith("updater-manifest.mjs")) {
  main(process.argv.slice(2));
}
