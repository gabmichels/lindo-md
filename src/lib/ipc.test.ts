import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FALLBACK } from "../hooks/useConfig";
import {
  AnnotationListSchema,
  AnnotationSchema,
  AppConfigSchema,
  StoredCustomThemesSchema,
} from "./ipc";
import { PRESETS } from "./theme/presets";
import { EMPTY_SESSION } from "./tabs/model";

/**
 * `config.json` is a file a reader can edit, and a schema that tightens in a release
 * invalidates whatever it now refuses. Both are ordinary. Neither may cost someone
 * their themes, their recents and their session — which is what rejecting the whole
 * config did, since `useConfig` then falls back to defaults and writes them back.
 */

const good = PRESETS[0]!.light;

function config(customThemes: unknown) {
  return {
    version: 1,
    themeId: "house",
    appearance: "system",
    customThemes,
    railWidth: 260,
    railCollapsed: false,
    railTreeCollapsed: false,
    recentFiles: ["C:/notes/a.md", "C:/notes/b.md"],
    lastFolder: "C:/notes",
    blockRemoteImages: true,
    respectGitignore: true,
    showHiddenFiles: false,
    reopenLastDocument: true,
    checkForUpdates: true,
    zoom: 1,
    smartPunctuation: false,
    session: EMPTY_SESSION,
  };
}

describe("StoredCustomThemesSchema", () => {
  it("keeps the themes that parse and drops only the one that does not", () => {
    const broken = structuredClone(good) as Record<string, unknown>;
    delete broken.colors;

    const parsed = StoredCustomThemesSchema.parse([good, broken, { ...good, id: "second" }]);

    expect(parsed).toHaveLength(2);
    expect(parsed.map((t) => t.id)).toEqual([good.id, "second"]);
  });

  it("preserves order", () => {
    const themes = ["a", "b", "c"].map((id) => ({ ...good, id }));
    expect(StoredCustomThemesSchema.parse(themes).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("degrades to empty rather than throwing when the value is not a list at all", () => {
    expect(StoredCustomThemesSchema.parse("not an array")).toEqual([]);
    expect(StoredCustomThemesSchema.parse(null)).toEqual([]);
    expect(StoredCustomThemesSchema.parse(undefined)).toEqual([]);
  });

  it("survives a theme missing one nested field, which is what a schema change looks like", () => {
    const stale = structuredClone(good) as { colors: Record<string, unknown> };
    // Exactly the audit's trigger: drop one leaf from an otherwise valid theme.
    delete stale.colors.selection;
    expect(StoredCustomThemesSchema.parse([stale, good])).toHaveLength(1);
  });
});

describe("AppConfigSchema", () => {
  it("does not let one unreadable theme take the rest of the config with it", () => {
    const broken = structuredClone(good) as Record<string, unknown>;
    delete broken.typography;

    const parsed = AppConfigSchema.parse(config([good, broken]));

    // The whole point: everything else in the file survives.
    expect(parsed.customThemes).toHaveLength(1);
    expect(parsed.recentFiles).toEqual(["C:/notes/a.md", "C:/notes/b.md"]);
    expect(parsed.lastFolder).toBe("C:/notes");
    expect(parsed.themeId).toBe("house");
    expect(parsed.railWidth).toBe(260);
  });

  it("still parses a config whose themes are all fine", () => {
    const parsed = AppConfigSchema.parse(config([good]));
    expect(parsed.customThemes).toHaveLength(1);
  });

  it("still rejects a config that is broken outside the themes", () => {
    // Degrading `customThemes` must not turn the config schema into a rubber stamp:
    // a missing required field is still a real parse failure.
    const missingRequired = config([good]) as Record<string, unknown>;
    delete missingRequired.zoom;
    expect(AppConfigSchema.safeParse(missingRequired).success).toBe(false);
  });
});

describe("the config contract with Rust", () => {
  /**
   * `test/fixtures/config-default.json` is what `AppConfig::default()` actually
   * serializes to — pinned on the Rust side by `config.rs`'s own test. Reading it here
   * makes the shape one thing both sides are compared against instead of three
   * hand-maintained copies.
   *
   * AGENTS.md says a new setting has to land in five places. Nothing checked that it
   * had, so a field added in Rust and forgotten in the schema was a runtime surprise
   * for whoever opened the app next, and a field missing from `FALLBACK` was a
   * `undefined` reaching a component only when the config failed to load.
   */
  // Read from the project root, as `version.test.mjs` does — under jsdom
  // `import.meta.url` is not a file URL and `new URL(...)` throws.
  const fixture = JSON.parse(readFileSync("test/fixtures/config-default.json", "utf8")) as Record<
    string,
    unknown
  >;

  it("the zod schema parses exactly what Rust sends", () => {
    const result = AppConfigSchema.safeParse(fixture);
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true);
  });

  it("the schema keeps every field Rust sends", () => {
    // `safeParse` succeeding is not enough: zod strips unknown keys by default, so a
    // field the schema has never heard of parses cleanly and then silently is not there.
    const parsed = AppConfigSchema.parse(fixture) as Record<string, unknown>;
    const missing = Object.keys(fixture).filter((key) => !(key in parsed));
    expect(
      missing,
      `AppConfigSchema drops ${missing.join(", ")} — add them to src/lib/ipc.ts`,
    ).toEqual([]);
  });

  /**
   * Fields Rust may leave out of the JSON entirely rather than sending as null —
   * `#[serde(skip_serializing_if = "Option::is_none")]` in `config.rs`.
   *
   * Listed rather than inferred, so adding another one is a deliberate edit here. This
   * test's first run failed on `lastFolder` and the contract, not the code, turned out
   * to be what I had wrong: an absent key and a null key are different things on the
   * wire, and the schema has to accept both.
   */
  const OMITTED_WHEN_NONE = ["lastFolder"];

  it("FALLBACK has exactly the fields Rust can send", () => {
    const expected = [...Object.keys(fixture), ...OMITTED_WHEN_NONE].sort();
    const fallbackKeys = Object.keys(FALLBACK).sort();
    expect(fallbackKeys, "FALLBACK in hooks/useConfig.tsx has drifted from AppConfig").toEqual(
      expected,
    );
  });

  it("the schema accepts a config with the optional fields absent", () => {
    // Which is what Rust actually sends on a fresh install — the fixture is exactly
    // that, and `lastFolder` is simply not in it.
    for (const key of OMITTED_WHEN_NONE) {
      expect(key in fixture, `${key} should be absent from a default config`).toBe(false);
    }
    expect(AppConfigSchema.safeParse(fixture).success).toBe(true);
  });

  it("the schema also accepts them sent explicitly as null", () => {
    const withNulls = {
      ...fixture,
      ...Object.fromEntries(OMITTED_WHEN_NONE.map((k) => [k, null])),
    };
    const parsed = AppConfigSchema.safeParse(withNulls);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("FALLBACK agrees with Rust on the scalar defaults", () => {
    // Not every value: `session` is normalized on the way through and the arrays are
    // empty either way. The scalars are the ones a reader notices being wrong — a
    // different default zoom or theme after a failed load looks like the app broke.
    for (const key of ["themeId", "appearance", "railWidth", "zoom", "blockRemoteImages"]) {
      expect(FALLBACK[key as keyof typeof FALLBACK], key).toEqual(fixture[key]);
    }
  });
});

describe("AnnotationSchema", () => {
  /** One row exactly as `annotations::Annotation` serializes it. */
  const row = {
    id: 1,
    path: "C:/notes/a.md",
    color: "yellow",
    body: "",
    quote: "the marked words",
    prefix: "before ",
    suffix: " after",
    startOffset: 10,
    endOffset: 26,
    anchoredHash: "abc123",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };

  it("accepts a row as Rust sends it", () => {
    const parsed = AnnotationSchema.safeParse(row);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("drops an unreadable row rather than the whole list", () => {
    // These rows are the reader's own notes and they outlive any single release,
    // so tightening this schema — adding a colour-slot enum, say — must not take
    // out every other mark on the document. Same rule as `customThemes`.
    const list = AnnotationListSchema.parse([row, { id: 2 }, { ...row, id: 3 }]);

    expect(list.map((a) => a.id)).toEqual([1, 3]);
  });

  it("refuses a negative offset", () => {
    // An offset below zero cannot index a string, so a row carrying one would
    // paint nothing and search from a nonsense position.
    expect(AnnotationSchema.safeParse({ ...row, startOffset: -1 }).success).toBe(false);
  });
});
