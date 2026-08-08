import { describe, expect, it } from "vitest";

import { findPreset } from "./presets";
import { CVD_SYNTAX } from "./shiki-house";

/**
 * The Colorblind Safe preset makes a claim in its name, and this is where it is
 * checked.
 *
 * A theme called "Colorblind Safe" that is merely *intended* to be safe is the
 * worst of both worlds: it tells a reader who cannot check it that the problem
 * has been handled. So the check is mechanical. Every pair of colours a reader
 * has to tell apart is run through a simulation of each of the three common
 * deficiencies and measured, and the whole thing fails if any pair comes out
 * closer than a floor. Adjusting a colour by eye is fine — this is what says
 * which other colour it stopped working beside.
 */

/**
 * Machado, Oliveira and Fernandes (2009), severity 1.0.
 *
 * Applied to *linear* RGB, which is why the gamma round-trip below is not
 * optional: run these on gamma-encoded bytes and every distance comes out
 * flattering by a wide margin.
 */
const SIMULATIONS = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const;

type Deficiency = keyof typeof SIMULATIONS;

/**
 * How far apart two colours have to stay, in sRGB units after simulation.
 *
 * Calibrated against what it is replacing rather than picked: GitHub's alert
 * hues — the default every other preset in the app uses — come out at 9, and
 * the test below pins that number so the comparison stays honest. 25 is nearly
 * three times that, and the palettes clear it with room (40 and 32 for the
 * alerts, 49 and 67 for the syntax colours), so a small adjustment for taste
 * will not trip it and a change that actually collapses a pair will.
 */
const FLOOR = 25;

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  return [r!, g!, b!];
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

function simulate(hex: string, deficiency: Deficiency): [number, number, number] {
  const [r, g, b] = channels(hex).map(toLinear) as [number, number, number];
  const matrix = SIMULATIONS[deficiency];
  return matrix.map((row) => {
    const value = row[0] * r + row[1] * g + row[2] * b;
    return Math.min(1, Math.max(0, toGamma(value))) * 255;
  }) as [number, number, number];
}

/** The closest any two of these colours come under any of the three. */
function worstSeparation(colors: Record<string, string>): {
  distance: number;
  pair: string;
} {
  const entries = Object.entries(colors);
  let worst = { distance: Infinity, pair: "" };

  for (const deficiency of Object.keys(SIMULATIONS) as Deficiency[]) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, b] = [simulate(entries[i]![1], deficiency), simulate(entries[j]![1], deficiency)];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (distance < worst.distance) {
          worst = { distance, pair: `${entries[i]![0]}/${entries[j]![0]} under ${deficiency}` };
        }
      }
    }
  }
  return worst;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

const colorblind = findPreset("colorblind")!;

describe("Colorblind Safe alerts", () => {
  for (const half of ["light", "dark"] as const) {
    it(`keeps the five kinds apart under every deficiency (${half})`, () => {
      const { note, tip, important, warning, caution } = colorblind[half].colors.alert;
      const worst = worstSeparation({ note, tip, important, warning, caution });
      expect(worst.distance, `closest pair: ${worst.pair}`).toBeGreaterThanOrEqual(FLOOR);
    });

    it(`keeps every alert readable as the callout's title text (${half})`, () => {
      // `document.css` paints `.markdown-alert-title` with the alert colour, at
      // 0.8em — small enough that WCAG's 4.5:1 for body text is the bar, not the
      // 3:1 a large heading would get. A hue that separates but cannot be read
      // has moved the problem rather than solved it.
      const { bg, alert } = colorblind[half].colors;
      for (const [kind, color] of Object.entries(alert)) {
        expect(contrast(color, bg), `${kind} on the page`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("is a real improvement on the hues every other preset uses", () => {
    // The number this preset exists because of. GitHub's set — the default in
    // `presets.ts`, and what House, Nord, Solarized and the rest all show —
    // puts note and important 9 apart under deuteranopia, which is to say on
    // top of each other. Pinned rather than merely asserted to be under the
    // floor, because the point is the size of the gap, not that there is one.
    const { note, tip, important, warning, caution } = findPreset("house")!.light.colors.alert;
    const worst = worstSeparation({ note, tip, important, warning, caution });
    expect(worst.distance).toBeCloseTo(9, 1);
    expect(worst.pair).toBe("note/important under deuteranopia");
  });
});

describe("Colorblind Safe syntax colors", () => {
  for (const half of ["light", "dark"] as const) {
    it(`keeps the six scope colors apart under every deficiency (${half})`, () => {
      const { string, keyword, func, constant, type, invalid } = CVD_SYNTAX[half];
      const worst = worstSeparation({ string, keyword, func, constant, type, invalid });
      expect(worst.distance, `closest pair: ${worst.pair}`).toBeGreaterThanOrEqual(FLOOR);
    });

    it(`keeps every scope color readable on the code background (${half})`, () => {
      const palette = CVD_SYNTAX[half];
      for (const scope of ["string", "keyword", "func", "constant", "type", "invalid"] as const) {
        expect(contrast(palette[scope], palette.bg), scope).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`renders code on the background the preset's page gives it (${half})`, () => {
      // Shiki paints the block's background from the theme object, and the page
      // paints the same area from `--doc-code-bg`. If the two disagree the block
      // gets a rectangle of a slightly different grey, and every contrast figure
      // checked above is against the wrong one.
      expect(CVD_SYNTAX[half].bg).toBe(colorblind[half].colors.codeBg);
    });
  }
});
