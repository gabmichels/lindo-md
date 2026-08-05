/**
 * The version rules decide what ships. A wrong answer here is not a crash — it is a release
 * that silently skips a fix, or a 1.0.0 nobody meant to declare — so the rules are pinned by
 * example rather than left to be re-read out of the script.
 *
 * These mirror the table under "Releasing" in AGENTS.md.
 */
import { describe, expect, it } from "vitest";
import { bumpVersion, deriveLevel, levelOf, planRelease } from "./version.mjs";

const commit = (subject, body = "") => ({ subject, body });

describe("levelOf", () => {
  it("maps feat to minor and fix/perf to patch", () => {
    expect(levelOf(commit("feat: tabs and tab groups"))).toBe("minor");
    expect(levelOf(commit("fix: cursor jumps to the start"))).toBe("patch");
    expect(levelOf(commit("perf: memoize the source map"))).toBe("patch");
  });

  it("releases nothing for types with no observable behaviour change", () => {
    for (const type of ["docs", "chore", "refactor", "test", "ci", "style", "build"]) {
      expect(levelOf(commit(`${type}: something`))).toBeNull();
    }
  });

  it("reads scopes", () => {
    expect(levelOf(commit("fix(tabs): keep the + button beside the last tab"))).toBe("patch");
    expect(levelOf(commit("feat(export): standalone HTML"))).toBe("minor");
  });

  it("treats the ! marker as breaking, whatever the type", () => {
    expect(levelOf(commit("feat!: drop the old config format"))).toBe("major");
    expect(levelOf(commit("refactor!: rename pretty-md to lindo-md"))).toBe("major");
    expect(levelOf(commit("fix(config)!: reject unknown keys"))).toBe("major");
  });

  it("reads BREAKING CHANGE out of the body, in both spellings", () => {
    expect(levelOf(commit("feat: new config", "BREAKING CHANGE: keys renamed"))).toBe("major");
    expect(levelOf(commit("feat: new config", "BREAKING-CHANGE: keys renamed"))).toBe("major");
  });

  it("only honours BREAKING CHANGE at the start of a line", () => {
    // Otherwise prose describing a change — "this is not a BREAKING CHANGE: ..." — bumps major.
    expect(levelOf(commit("fix: tidy", "not a BREAKING CHANGE: just a note"))).toBe("patch");
  });

  it("counts a non-conventional subject as no-op rather than throwing", () => {
    // The script lists these so a miscategorized commit is visible before the tag exists.
    expect(levelOf(commit("Merge pull request #2 from gabmichels/feat"))).toBeNull();
    expect(levelOf(commit("wip"))).toBeNull();
  });
});

describe("deriveLevel", () => {
  it("takes the highest level any single commit asks for", () => {
    expect(deriveLevel([commit("fix: a"), commit("feat: b"), commit("fix: c")])).toBe("minor");
    expect(deriveLevel([commit("fix: a"), commit("feat!: b")])).toBe("major");
    expect(deriveLevel([commit("fix: a"), commit("fix: b")])).toBe("patch");
  });

  it("is null when nothing user-visible landed", () => {
    expect(deriveLevel([commit("docs: a"), commit("chore: b")])).toBeNull();
    expect(deriveLevel([])).toBeNull();
  });
});

describe("bumpVersion", () => {
  it("bumps each level and zeroes what follows", () => {
    expect(bumpVersion("0.3.1", "patch")).toBe("0.3.2");
    expect(bumpVersion("0.3.1", "minor")).toBe("0.4.0");
    expect(bumpVersion("0.3.1", "major")).toBe("1.0.0");
    expect(bumpVersion("1.9.9", "minor")).toBe("1.10.0");
  });

  it("passes an explicit version through", () => {
    expect(bumpVersion("0.3.1", "2.0.0")).toBe("2.0.0");
  });

  it("rejects nonsense rather than guessing", () => {
    expect(() => bumpVersion("0.3.1", "huge")).toThrow(/unknown bump/);
    expect(() => bumpVersion("not-a-version", "patch")).toThrow(/not X\.Y\.Z/);
  });
});

describe("planRelease", () => {
  const feat = [commit("feat: a thing")];

  it("ships the current version as the first release, without bumping past it", () => {
    // 0.1.0 has never been published, so there is no reason for the first tag to be 0.2.0.
    const plan = planRelease({ current: "0.1.0", lastTag: null, commits: feat });
    expect(plan).toMatchObject({ action: "release", version: "0.1.0" });
  });

  it("derives the bump from the commits once something has shipped", () => {
    expect(planRelease({ current: "0.1.0", lastTag: "v0.1.0", commits: feat })).toMatchObject({
      action: "release",
      version: "0.2.0",
      level: "minor",
    });
  });

  it("does nothing when only no-op commits landed", () => {
    const plan = planRelease({
      current: "0.1.0",
      lastTag: "v0.1.0",
      commits: [commit("docs: tidy"), commit("chore: deps")],
    });
    expect(plan.action).toBe("none");
  });

  it("keeps a pre-1.0 breaking change a minor", () => {
    const plan = planRelease({
      current: "0.3.1",
      lastTag: "v0.3.1",
      commits: [commit("feat!: drop the old config")],
    });
    expect(plan).toMatchObject({ action: "release", version: "0.4.0", level: "minor" });
    expect(plan.reason).toMatch(/pre-1\.0/);
  });

  it("lets a breaking change bump major once stable", () => {
    const plan = planRelease({
      current: "1.2.0",
      lastTag: "v1.2.0",
      commits: [commit("feat!: drop the old config")],
    });
    expect(plan).toMatchObject({ action: "release", version: "2.0.0", level: "major" });
  });

  it("honours an override, including releasing when nothing user-visible landed", () => {
    const docsOnly = [commit("docs: tidy")];
    expect(
      planRelease({ current: "0.1.0", lastTag: "v0.1.0", commits: docsOnly, override: "patch" }),
    ).toMatchObject({ action: "release", version: "0.1.1" });

    // Going 1.0 is deliberate and manual — no commit message can trigger it.
    expect(
      planRelease({ current: "0.9.0", lastTag: "v0.9.0", commits: feat, override: "1.0.0" }),
    ).toMatchObject({ action: "release", version: "1.0.0" });
  });

  it("rejects an unknown override rather than guessing", () => {
    expect(() =>
      planRelease({ current: "0.1.0", lastTag: "v0.1.0", commits: feat, override: "huge" }),
    ).toThrow(/unknown bump/);
  });
});
