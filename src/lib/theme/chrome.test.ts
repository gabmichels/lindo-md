import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { chromeTokens } from "./chrome";
import { contrastRatio, toOklch } from "./color";
import { PRESETS } from "./presets";
import { resolveTheme } from "./presets";
import type { Theme } from "./schema";

/**
 * The chrome is derived, so its promises have to be checked by construction
 * rather than by looking at fifteen presets and calling it fine.
 *
 * Every case below runs against every preset in both appearances. That is the
 * whole point of deriving it: a sixteenth preset, or a theme a reader wrote,
 * gets the same guarantees without anyone remembering to re-check.
 */

const EVERY: { name: string; theme: Theme }[] = PRESETS.flatMap((preset) => [
  { name: `${preset.id} light`, theme: preset.light },
  { name: `${preset.id} dark`, theme: preset.dark },
]);

/** The rungs, and the bar each was solved to in `chrome.ts`. A shade under, to
 *  leave room for the bisection's last halving rather than for drift. */
const INK_BARS: [string, number][] = [
  ["--ui-text-strong", 12],
  ["--ui-text", 8],
  ["--ui-text-muted", 4.8],
  ["--ui-text-faint", 3.2],
];

describe("chromeTokens", () => {
  it("writes only --ui-* properties", () => {
    for (const { name, theme } of EVERY) {
      for (const property of Object.keys(chromeTokens(theme))) {
        expect(property.startsWith("--ui-"), `${name} wrote ${property}`).toBe(true);
      }
    }
  });

  it("writes the same set of properties for every theme", () => {
    const expected = Object.keys(chromeTokens(PRESETS[0]!.light)).sort();
    for (const { name, theme } of EVERY) {
      expect(Object.keys(chromeTokens(theme)).sort(), name).toEqual(expected);
    }
  });

  it("keeps every rung of the text ramp legible on the rail", () => {
    for (const { name, theme } of EVERY) {
      const tokens = chromeTokens(theme);
      for (const [token, bar] of INK_BARS) {
        const ratio = contrastRatio(tokens["--ui-base"]!, tokens[token]!);
        // The solver returns the extreme when a target is unreachable, so the
        // assertion is "as close as this ground allows" rather than a flat bar:
        // a mid-grey paper cannot carry 12:1 and must not fail the build for it.
        const best = contrastRatio(tokens["--ui-base"]!, ratio > 1 ? "#000000" : "#ffffff");
        expect(ratio, `${name} ${token}`).toBeGreaterThanOrEqual(Math.min(bar - 0.05, best));
      }
    }
  });

  it("keeps the ramp ordered — strong is never quieter than faint", () => {
    for (const { name, theme } of EVERY) {
      const tokens = chromeTokens(theme);
      const ratios = INK_BARS.map(([token]) => contrastRatio(tokens["--ui-base"]!, tokens[token]!));
      for (let i = 1; i < ratios.length; i += 1) {
        expect(ratios[i - 1], `${name} rung ${i}`).toBeGreaterThanOrEqual(ratios[i]! - 0.01);
      }
    }
  });

  it("keeps the accent visible as a mark on the rail", () => {
    for (const { name, theme } of EVERY) {
      const tokens = chromeTokens(theme);
      expect(
        contrastRatio(tokens["--ui-base"]!, tokens["--ui-accent"]!),
        `${name} accent`,
      ).toBeGreaterThanOrEqual(2.95);
    }
  });

  it("keeps text legible on the accent itself", () => {
    for (const { name, theme } of EVERY) {
      const tokens = chromeTokens(theme);
      expect(
        contrastRatio(tokens["--ui-accent"]!, tokens["--ui-accent-ink"]!),
        `${name} accent ink`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps danger legible as text", () => {
    for (const { name, theme } of EVERY) {
      const tokens = chromeTokens(theme);
      expect(
        contrastRatio(tokens["--ui-base"]!, tokens["--ui-danger"]!),
        `${name} danger`,
      ).toBeGreaterThanOrEqual(4.45);
    }
  });

  it("separates the rail from the paper it lies on", () => {
    // Not a contrast bar — two surfaces, not text on one. What is being ruled
    // out is a rail that has become the same colour as the page, which would
    // dissolve the seam and take the tool/paper distinction with it.
    for (const { name, theme } of EVERY) {
      const paper = toOklch(theme.colors.bg);
      const rail = toOklch(chromeTokens(theme)["--ui-base"]!);
      expect(Math.abs((paper?.l ?? 0) - (rail?.l ?? 0)), `${name} seam`).toBeGreaterThan(0.03);
    }
  });

  it("keeps the tool quieter than the paper", () => {
    for (const { name, theme } of EVERY) {
      const paper = toOklch(theme.colors.bg);
      const rail = toOklch(chromeTokens(theme)["--ui-base"]!);
      // A rail more saturated than the page competes with it. It may be equal —
      // both near-neutral is the common case — but never louder.
      expect(rail?.c ?? 0, `${name} chroma`).toBeLessThanOrEqual((paper?.c ?? 0) + 0.0001);
    }
  });

  it("gives the planes somewhere to go", () => {
    for (const { name, theme } of EVERY) {
      const tokens = chromeTokens(theme);
      const l = (token: string) => toOklch(tokens[token]!)?.l ?? 0;
      // Depth runs one way and recession the other, so plane-2 and sunken sit on
      // opposite sides of base whichever appearance this is.
      const up = l("--ui-plane-1") - l("--ui-base");
      expect(Math.abs(up), `${name} plane step`).toBeGreaterThan(0.02);
      expect(Math.sign(l("--ui-plane-2") - l("--ui-base")), `${name} plane direction`).toBe(
        Math.sign(up),
      );
      expect(Math.sign(l("--ui-sunken") - l("--ui-base")), `${name} sunken`).toBe(-Math.sign(up));
    }
  });
});

describe("the first-paint defaults in styles.css", () => {
  /**
   * `styles.css` carries House Light's chrome so the window is already right
   * before React mounts. Hand-copied values rot silently — the app overwrites
   * them a frame later, so a stale default shows only as a flash nobody files a
   * bug about. This recomputes them.
   */
  const css = readFileSync("src/styles.css", "utf8");
  const house = resolveTheme("house", "light", []);

  /** The declared value of one property, so a mismatch reports two colours
   *  rather than diffing the whole stylesheet. */
  function declared(property: string): string | null {
    const match = new RegExp(`\\n\\s*${property}:\\s*([^;]+);`).exec(css);
    return match ? match[1]!.trim() : null;
  }

  it("match what chromeTokens derives from House Light", () => {
    for (const [property, value] of Object.entries(chromeTokens(house))) {
      expect(declared(property), property).toBe(value);
    }
  });
});
