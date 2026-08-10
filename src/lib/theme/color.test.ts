import { describe, expect, it } from "vitest";

import { toHex } from "./color";
import { mermaidThemeVariables } from "./apply";
import { PRESETS } from "./presets";

describe("toHex", () => {
  it("passes hex through, normalizing case and short form", () => {
    expect(toHex("#AABBCC")).toBe("#aabbcc");
    expect(toHex("#abc")).toBe("#aabbcc");
  });

  it("converts rgb and rgba", () => {
    expect(toHex("rgb(255, 0, 128)")).toBe("#ff0080");
    expect(toHex("rgba(0 128 255 / 0.5)")).toBe("#0080ff");
  });

  it("converts oklch, which is the case that actually broke Mermaid", () => {
    // Reference values: pure white, pure black, and the House ink.
    expect(toHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(toHex("oklch(0 0 0)")).toBe("#000000");

    // A mid grey stays neutral — equal channels — rather than picking up a cast.
    const grey = toHex("oklch(0.5 0 0)");
    expect(grey.slice(1, 3)).toBe(grey.slice(3, 5));
    expect(grey.slice(3, 5)).toBe(grey.slice(5, 7));
  });

  it("reads oklch lightness and chroma given as percentages", () => {
    expect(toHex("oklch(100% 0 0)")).toBe("#ffffff");
  });

  it("clamps a colour that falls outside sRGB instead of wrapping it", () => {
    // A chroma this high has no sRGB equivalent; every channel must still be a
    // valid byte rather than a negative number rendered as garbage.
    expect(toHex("oklch(0.7 0.5 150)")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("returns the fallback for something it cannot read", () => {
    expect(toHex("not-a-colour")).toBe("#000000");
    expect(toHex("color-mix(in oklab, red 50%, blue)", "#123456")).toBe("#123456");
  });

  it("round-trips: a converted colour converts to itself", () => {
    const once = toHex("oklch(0.48 0.09 200)");
    expect(toHex(once)).toBe(once);
  });
});

describe("mermaidThemeVariables", () => {
  it("never fills a node with the colour of the tray it sits on", () => {
    // `document.css` draws `figure.mermaid` on `--doc-surface`. A node filled
    // with that same value has no shape of its own — it is visible only where
    // its 1px border is, which is what a diagram looked like before this.
    for (const preset of PRESETS) {
      for (const half of ["light", "dark"] as const) {
        const vars = mermaidThemeVariables(preset[half]);
        const tray = toHex(preset[half].colors.surface);
        expect(vars.mainBkg, `${preset.id}.${half}`).not.toBe(tray);
        expect(vars.primaryColor, `${preset.id}.${half}`).not.toBe(tray);
      }
    }
  });

  it("hands Mermaid only hex, for every preset", () => {
    // The regression this guards: Mermaid's colour parser rejects oklch() with
    // "Unsupported color format", and every diagram in the document fails.
    for (const preset of PRESETS) {
      for (const half of ["light", "dark"] as const) {
        const vars = mermaidThemeVariables(preset[half]);
        for (const [key, value] of Object.entries(vars)) {
          if (key === "fontFamily" || key === "fontSize") continue;
          expect(value, `${preset.id}.${half} ${key} = ${value}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it("still distinguishes the light and dark halves after conversion", () => {
    const house = PRESETS[0]!;
    expect(mermaidThemeVariables(house.light).background).not.toBe(
      mermaidThemeVariables(house.dark).background,
    );
  });
});
