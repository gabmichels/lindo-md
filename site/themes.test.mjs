import { describe, expect, it } from "vitest";

import { PRESETS } from "../src/lib/theme/presets";
import { THEMES, tokensFor } from "./themes.js";

/**
 * The site carries its own copy of the palettes — see the header of
 * `themes.js` for why it cannot import the app's. A copy that nobody checks is
 * a copy that is wrong within two releases, and the failure is silent: the
 * gallery keeps rendering, it just shows a Nord that stopped being Nord.
 *
 * So these are the tests that make the copy safe rather than merely convenient.
 * They fail the build, not a review.
 */

const APPEARANCES = /** @type {const} */ (["light", "dark"]);

describe("the site's palette copy", () => {
  it("has every preset the app ships, in the same order", () => {
    expect(THEMES.map((t) => t.id)).toEqual(PRESETS.map((p) => p.id));
  });

  it("carries each preset's name and note verbatim", () => {
    for (const preset of PRESETS) {
      const copy = THEMES.find((t) => t.id === preset.id);
      expect(copy.name, preset.id).toBe(preset.name);
      expect(copy.note, preset.id).toBe(preset.note);
    }
  });

  it.each(APPEARANCES)("matches the app's %s palette colour for colour", (appearance) => {
    for (const preset of PRESETS) {
      const app = preset[appearance].colors;
      const copy = THEMES.find((t) => t.id === preset.id)[appearance];
      const where = `${preset.id} ${appearance}`;

      expect({ where, ...copy, accent: copy.accent ?? copy.link }).toEqual({
        where,
        bg: app.bg,
        surface: app.surface,
        text: app.text,
        muted: app.textMuted,
        heading: app.heading,
        link: app.link,
        border: app.border,
        codeBg: app.codeBg,
        accent: app.accent,
      });
    }
  });

  it.each(APPEARANCES)("uses the app's five %s alert hues", (appearance) => {
    for (const preset of PRESETS) {
      const theme = THEMES.find((t) => t.id === preset.id);
      const tokens = tokensFor(theme, appearance);
      const app = preset[appearance].colors.alert;

      expect({ id: preset.id, ...pickAlerts(tokens) }).toEqual({ id: preset.id, ...app });
    }
  });
});

describe("tokensFor", () => {
  /* The trap `apply.ts` documents: a half that writes only what it changes
   * leaves the previous theme's colours showing through, because these land on
   * one element and are never cleared between themes. */
  it("writes the same set of properties for every preset and appearance", () => {
    const expected = Object.keys(tokensFor(THEMES[0], "light")).sort();

    for (const theme of THEMES) {
      for (const appearance of APPEARANCES) {
        expect(
          Object.keys(tokensFor(theme, appearance)).sort(),
          `${theme.id} ${appearance}`,
        ).toEqual(expected);
      }
    }
  });

  it("never leaves a property empty", () => {
    for (const theme of THEMES) {
      for (const appearance of APPEARANCES) {
        for (const [name, value] of Object.entries(tokensFor(theme, appearance))) {
          expect(value, `${theme.id} ${appearance} ${name}`).toMatch(/\S/);
        }
      }
    }
  });

  it("falls back to the link when a palette states no accent", () => {
    const github = THEMES.find((t) => t.id === "github");
    expect(github.light.accent).toBeUndefined();
    expect(tokensFor(github, "light")["--accent"]).toBe(github.light.link);
  });
});

function pickAlerts(tokens) {
  return {
    note: tokens["--note"],
    tip: tokens["--tip"],
    important: tokens["--important"],
    warning: tokens["--warning"],
    caution: tokens["--caution"],
  };
}
