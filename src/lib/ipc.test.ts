import { describe, expect, it } from "vitest";

import { AppConfigSchema, StoredCustomThemesSchema } from "./ipc";
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
    recentFiles: ["C:/notes/a.md", "C:/notes/b.md"],
    lastFolder: "C:/notes",
    blockRemoteImages: true,
    respectGitignore: true,
    showHiddenFiles: false,
    reopenLastDocument: true,
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
