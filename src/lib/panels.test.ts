import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { NOTES_DEFAULT, PANEL_MAX, PANEL_MIN, RAIL_DEFAULT } from "./panels";

/**
 * The drag handles clamp in the browser and `config.rs` clamps on the way to
 * disk. Two clamps that disagree is a panel that can be dragged to a width the
 * next launch quietly takes away, which reads as the app forgetting.
 */

// Read from the project root, as `ipc.test.ts` does — under jsdom
// `import.meta.url` is not a file URL and `new URL(...)` throws.
const RUST = readFileSync("src-tauri/src/config.rs", "utf8");

function constant(name: string): number {
  const match = new RegExp(`${name}: u32 = (\\d+);`).exec(RUST);
  if (!match) throw new Error(`${name} is gone from config.rs`);
  return Number(match[1]);
}

function defaultFn(name: string): number {
  const match = new RegExp(`fn ${name}\\(\\) -> u32 \\{\\s*(\\d+)`).exec(RUST);
  if (!match) throw new Error(`${name}() is gone from config.rs`);
  return Number(match[1]);
}

describe("panel widths", () => {
  it("shares its band with the Rust clamp", () => {
    expect(PANEL_MIN).toBe(constant("PANEL_WIDTH_MIN"));
    expect(PANEL_MAX).toBe(constant("PANEL_WIDTH_MAX"));
  });

  it("resets to the widths Rust defaults to", () => {
    expect(RAIL_DEFAULT).toBe(defaultFn("default_rail_width"));
    expect(NOTES_DEFAULT).toBe(defaultFn("default_notes_width"));
  });

  it("keeps both defaults inside the band", () => {
    for (const width of [RAIL_DEFAULT, NOTES_DEFAULT]) {
      expect(width).toBeGreaterThanOrEqual(PANEL_MIN);
      expect(width).toBeLessThanOrEqual(PANEL_MAX);
    }
  });
});
