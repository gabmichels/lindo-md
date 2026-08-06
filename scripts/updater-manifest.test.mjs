/**
 * The manifest decides what every installed copy of lindo-md downloads and runs next.
 * A wrong URL in it is not a broken build — it is a working installer for the wrong
 * thing, delivered to everyone, and the signature check would pass because the file it
 * points at really was signed by the release key.
 *
 * So the matching is tested rather than trusted: which asset becomes which platform, and
 * that every way of getting it wrong stops the release instead of shipping a manifest
 * with a hole in it.
 */
import { describe, expect, it } from "vitest";

import { buildManifest } from "./updater-manifest.mjs";

const BASE = {
  version: "1.2.0",
  tag: "v1.2.0",
  repo: "gabmichels/lindo-md",
  notes: "lindo-md 1.2.0",
  pubDate: "2026-08-06T12:00:00.000Z",
};

const WINDOWS = { name: "lindo-md_1.2.0_x64-setup.exe", signature: "sig-windows\n" };
const LINUX = { name: "lindo-md_1.2.0_amd64.AppImage", signature: "sig-linux\n" };

function build(assets) {
  return buildManifest({ ...BASE, assets });
}

describe("buildManifest", () => {
  it("maps each installer to its platform key", () => {
    const manifest = build([WINDOWS, LINUX]);

    expect(Object.keys(manifest.platforms).sort()).toEqual(["linux-x86_64", "windows-x86_64"]);
    expect(manifest.platforms["windows-x86_64"].signature).toBe("sig-windows");
    expect(manifest.platforms["linux-x86_64"].signature).toBe("sig-linux");
  });

  it("points at the tag rather than at /releases/latest/", () => {
    // `latest` moves the moment the next release is published, so a client that fetched
    // this manifest a minute earlier would download a different file than the signature
    // in it describes.
    const url = build([WINDOWS, LINUX]).platforms["windows-x86_64"].url;

    expect(url).toBe(
      "https://github.com/gabmichels/lindo-md/releases/download/v1.2.0/lindo-md_1.2.0_x64-setup.exe",
    );
    expect(url).not.toContain("/releases/latest/");
  });

  it("carries the version and pub_date the updater compares against", () => {
    const manifest = build([WINDOWS, LINUX]);

    expect(manifest.version).toBe("1.2.0");
    expect(manifest.pub_date).toBe("2026-08-06T12:00:00.000Z");
  });

  it("refuses a release that is missing a platform", () => {
    // The failure this whole script exists to prevent: a manifest that parses, serves,
    // and tells half the users their platform has no update.
    expect(() => build([WINDOWS])).toThrow(/linux-x86_64/);
    expect(() => build([LINUX])).toThrow(/windows-x86_64/);
  });

  it("refuses an unsigned artifact rather than emitting an empty signature", () => {
    expect(() => build([{ ...WINDOWS, signature: "  \n" }, LINUX])).toThrow(/not signed/);
  });

  it("refuses an ambiguous match rather than picking one", () => {
    const other = { name: "lindo-md_1.2.0_arm64-setup.exe", signature: "sig-arm" };

    expect(() => build([WINDOWS, other, LINUX])).toThrow(/2 assets matched windows-x86_64/);
  });

  it("does not mistake the plain installer for the updater artifact of another target", () => {
    // An `.msi` is no longer built, and if one comes back it must not be matched by the
    // Windows rule — the two install to different places, and an NSIS-installed app
    // updated by an MSI is two copies of lindo-md rather than one.
    const msi = { name: "lindo-md_1.2.0_x64_en-US.msi", signature: "sig-msi" };
    const manifest = build([WINDOWS, msi, LINUX]);

    expect(manifest.platforms["windows-x86_64"].url).toContain("-setup.exe");
  });

  it("escapes a filename that would otherwise break the URL", () => {
    const spaced = { name: "lindo md_1.2.0_amd64.AppImage", signature: "sig" };

    expect(build([WINDOWS, spaced]).platforms["linux-x86_64"].url).toContain("lindo%20md");
  });
});
