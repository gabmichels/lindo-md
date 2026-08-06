/**
 * Facts about `release.yml` that nothing else would catch.
 *
 * Each one of these failed, or could have failed, without turning a job red. A workflow that
 * publishes the wrong thing successfully is the failure mode this file exists for — the release
 * page looks complete either way, and the symptom arrives weeks later as "the app never updates".
 *
 * Asserted against the workflow text rather than by running it, in the same spirit as the config
 * invariants in `src-tauri/src/lib.rs`: there is no code path to unit-test, only a file that has
 * to say the right thing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");

describe("the updater manifest", () => {
  it("uses the input name the pinned tauri-action actually has", () => {
    // v1.2.0 shipped with `uploadUpdaterJson`, which the pinned SHA does not accept. Actions
    // logged `##[warning]Unexpected input(s)` and carried on with the default of `true` — the
    // job passed, the release looked right, and the setting simply did nothing. An unrecognised
    // input is never an error, so this assertion is the only thing standing between a rename in
    // the action's docs and a silently ignored line in this workflow.
    expect(workflow).toContain("includeUpdaterJson: false");
    // Matched as a YAML key — `^\s*name:` — rather than anywhere in the file, because the
    // comment above that line names the wrong input on purpose, to explain the trap. A bare
    // substring check fails on its own documentation.
    expect(workflow).not.toMatch(/^\s*uploadUpdaterJson\s*:/m);
  });

  it("still has the job that writes the manifest instead", () => {
    // Turning the action's manifest off without this job leaves the release with no
    // `latest.json` at all, which no installed copy would report and no CI step would notice.
    expect(workflow).toMatch(/updater-manifest:/);
    expect(workflow).toContain("scripts/updater-manifest.mjs");
  });

  it("builds the manifest only after every bundle job", () => {
    // Without `needs`, it would race the builds and hash whatever had been uploaded so far.
    expect(workflow).toMatch(/updater-manifest:[\s\S]*?needs:\s*release/);
  });
});

describe("what Windows ships", () => {
  it("bundles NSIS only, so the updater has one installer to point at", () => {
    // Re-adding `msi` here is not a packaging preference: `latest.json` carries one installer
    // per platform and Tauri cannot tell which one a user originally ran, so an MSI-installed
    // copy updated from the `.exe` becomes two copies of the app.
    expect(workflow).toContain('args: "--bundles nsis"');
    expect(workflow).not.toMatch(/--bundles[^"\n]*\bmsi\b/);
  });
});

describe("update signing", () => {
  it("passes both signing secrets to the bundler", () => {
    // `createUpdaterArtifacts` makes the bundler demand these, and it demands them *after*
    // building the installer — so a missing one fails the release at the last step, having
    // spent the whole build.
    expect(workflow).toContain(
      "TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
    );
    expect(workflow).toContain(
      "TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}",
    );
  });
});
