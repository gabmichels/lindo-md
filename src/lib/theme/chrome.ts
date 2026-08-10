import { contrastRatio, oklchCss, readableInk, toOklch, type Oklch } from "./color";
import type { Theme } from "./schema";

/**
 * Turns a `Theme` into the `--ui-*` custom properties the chrome reads.
 *
 * This file is the answer to "why does the rail stay black when I pick a light
 * theme". It used to be that the tool was a fixed material and only the paper
 * changed — a defensible idea, and the one thing every reader read as a bug.
 *
 * The tool and the paper are still different materials. What changed is that the
 * difference is now *derived* rather than *fixed*: the chrome is built from the
 * theme's own ground, a step away from it and quieter, so it reads as the tool
 * beside that paper rather than as the tool beside any paper.
 *
 * ## Why derived rather than authored per theme
 *
 * The alternative is a chrome palette in every preset. With fifteen presets in
 * two appearances that is thirty hand-tuned palettes, each of which can be got
 * wrong quietly — and it does nothing at all for a theme a reader wrote
 * themselves, which is a file this code has never seen. Deriving means a custom
 * theme gets a chrome that works for the same reason House does.
 *
 * It also lets the guarantees be real. Every text token here is *solved* for a
 * contrast ratio against the surface it sits on rather than picked and checked,
 * so "the chrome is legible" is a property of the construction. `chrome.test.ts`
 * asserts it across every preset, in both appearances, and would catch a
 * sixteenth preset that broke it.
 *
 * ## What is still fixed
 *
 * The tab-group colours, which are user data rather than brand: the reader picks
 * a hue to tell their own groups apart, and a hue that shifted when they changed
 * theme would stop being the label they chose. See DESIGN.md.
 */

/**
 * How far the tool sits from the paper it lies on.
 *
 * Light grounds get the larger step because the eye reads a small lightness
 * difference at the top of the range as a printing artefact rather than as two
 * surfaces — the same 0.045 that clearly separates two dark planes is nearly
 * invisible between 0.985 and 0.94.
 */
const TOOL_OFFSET_ON_LIGHT = 0.075;
const TOOL_OFFSET_ON_DARK = 0.045;
/** Nothing may be pushed past these; a chrome at pure black or pure white has no
 *  room left to draw a plane on. */
const TOOL_FLOOR = 0.1;
const TOOL_CEILING = 0.95;

/** One plane of depth, measured toward the ink. Three stacked planes and a
 *  sunken one is the whole vocabulary — the chrome draws no borders. */
const PLANE_STEP_ON_DARK = 0.038;
const PLANE_STEP_ON_LIGHT = 0.045;

/**
 * The chrome is quiet by construction: whatever the paper's chroma, the tool
 * carries almost none of it. A rail as saturated as the page competes with it.
 *
 * `TOOL_CHROMA_SHARE` is what makes "quieter" true rather than "no louder". The
 * two differ by more than pedantry: at parity, an 8-bit round trip through sRGB
 * can hand back a hundredth more chroma than went in, so the tool could come out
 * fractionally louder than the paper it is derived from.
 */
const TOOL_CHROMA_SHARE = 0.8;
const TOOL_MAX_CHROMA = 0.018;
const INK_MAX_CHROMA = 0.014;

/**
 * Contrast each rung of the text ramp is solved to, against the surface it is
 * read on.
 *
 * Above WCAG AA throughout, because chrome text is small — 13px rows, 12px
 * secondary, 10.5px labels — and AA's 4.5:1 is written for body copy. The faint
 * rung is the exception at 3.2:1: it is for text that is deliberately receding
 * (a section label, a shortcut hint), and pushing it to 4.5 would make it stop
 * receding, which is its whole job.
 */
const INK_TARGETS = {
  strong: 12,
  text: 8,
  muted: 4.8,
  faint: 3.2,
} as const;

/** The bar the accent has to clear as a non-text mark, from WCAG 1.4.11. */
const ACCENT_CONTRAST = 3;
/** Danger is carried by text as well as by a mark, so it clears the text bar. */
const DANGER_CONTRAST = 4.5;

/** House's ground and accent, for a theme this file cannot read. Unparseable is
 *  not hypothetical — a theme is a shared file and `bg` accepts any CSS colour,
 *  including ones only a browser can resolve. */
const FALLBACK_GROUND: Oklch = { l: 0.985, c: 0.004, h: 85 };
const FALLBACK_ACCENT: Oklch = { l: 0.48, c: 0.09, h: 200 };

/**
 * The lightness closest to `from` that reads at `target` against `ground`.
 *
 * Contrast is monotonic in lightness once a direction is chosen — every step
 * away from the ground raises it — so a bisection lands on the *quietest* colour
 * that is still legible. That matters: the loudest legible colour is easy to
 * find and wrong, because chrome text at 21:1 on every rung is a rail that
 * shouts four different ways at once.
 *
 * If even the extreme cannot reach the target the extreme is what comes back.
 * That is a theme whose ground is a mid grey, where no ink reaches 12:1 and the
 * honest answer is the best available rather than a throw.
 */
function solveLightness(ground: string, target: number, hue: number, chroma: number): number {
  const groundL = toOklch(ground)?.l ?? 0.5;
  const towardBlack = groundL > 0.5;
  const ratioAt = (l: number) => contrastRatio(ground, oklchCss({ l, c: chroma, h: hue }));

  let [near, far] = towardBlack ? [groundL, 0] : [groundL, 1];
  if (ratioAt(far) < target) return far;

  // `near` never reaches the target and `far` always does; the answer is the
  // boundary between them, which twenty halvings locate to within 1e-6.
  for (let i = 0; i < 20; i += 1) {
    const mid = (near + far) / 2;
    if (ratioAt(mid) >= target) far = mid;
    else near = mid;
  }
  return far;
}

/** A colour kept at its own hue but moved to a lightness that reads on `ground`.
 *  The theme's choice of hue and chroma survives; only its brightness is the
 *  chrome's business. */
function legible(colour: Oklch, ground: string, target: number): Oklch {
  if (contrastRatio(ground, oklchCss(colour)) >= target) return colour;
  return { ...colour, l: solveLightness(ground, target, colour.h, colour.c) };
}

/**
 * The `--ui-*` properties for a theme.
 *
 * Deliberately the same shape as `docTokens`: a flat map of property to value,
 * applied by whoever owns the element. Nothing here reads the DOM, so the
 * settings drawer can derive a preview's chrome the same way the app derives its
 * own.
 */
export function chromeTokens(theme: Theme): Record<string, string> {
  const paper = toOklch(theme.colors.bg) ?? FALLBACK_GROUND;

  // The tool steps away from the paper's brightness, toward the middle of the
  // range. A near-white page gets a light grey tool, a near-black page a darker
  // one — in both directions the tool is the surface the page lies *on*.
  const onLight = paper.l > 0.5;
  const baseL = Math.min(
    TOOL_CEILING,
    Math.max(TOOL_FLOOR, paper.l - (onLight ? TOOL_OFFSET_ON_LIGHT : TOOL_OFFSET_ON_DARK)),
  );
  const toolChroma = Math.min(paper.c * TOOL_CHROMA_SHARE, TOOL_MAX_CHROMA);
  const base: Oklch = { l: baseL, c: toolChroma, h: paper.h };
  const baseCss = oklchCss(base);

  // Depth is drawn toward the ink and recession away from it, which is the same
  // rule in both appearances: on a dark tool a hovered row lifts toward white
  // and a sunken well drops toward black, and on a light tool both invert. The
  // light case is the familiar one from every desktop — a grey toolbar with a
  // white field sunk into it.
  const inkward = onLight ? -1 : 1;
  const step = (onLight ? PLANE_STEP_ON_LIGHT : PLANE_STEP_ON_DARK) * inkward;
  const plane = (n: number) => oklchCss({ ...base, l: Math.min(1, Math.max(0, baseL + step * n)) });

  const inkHue = paper.h;
  const inkChroma = Math.min(toolChroma, INK_MAX_CHROMA);
  const ink = (target: number) =>
    oklchCss({ l: solveLightness(baseCss, target, inkHue, inkChroma), c: inkChroma, h: inkHue });

  // Hairlines are the ink at low alpha rather than white at low alpha, which is
  // what makes them survive a light chrome: white on near-white is not a line.
  const inkStrong = ink(INK_TARGETS.strong);
  const hairline = (percent: number) =>
    `color-mix(in oklab, ${inkStrong} ${percent}%, transparent)`;

  // The one accent, taken from the theme rather than fixed. It still marks only
  // what it always marked — the active file, focus, progress, a droppable
  // window — but it is now the paper's own accent, so the tool and the page
  // agree about what "the highlighted thing" looks like.
  const accent = legible(toOklch(theme.colors.accent) ?? FALLBACK_ACCENT, baseCss, ACCENT_CONTRAST);
  const accentCss = oklchCss(accent);
  // Dim recedes toward the ground it sits on, in whichever direction that is.
  const accentDim = oklchCss({
    ...accent,
    l: Math.min(1, Math.max(0, accent.l - 0.12 * inkward)),
    c: accent.c * 0.85,
  });

  const danger = legible({ l: 0.58, c: 0.2, h: 25 }, baseCss, DANGER_CONTRAST);
  const dangerCss = oklchCss(danger);

  return {
    "--ui-base": baseCss,
    "--ui-plane-1": plane(1),
    "--ui-plane-2": plane(2),
    "--ui-sunken": plane(-1),

    "--ui-text": ink(INK_TARGETS.text),
    "--ui-text-strong": inkStrong,
    "--ui-text-muted": ink(INK_TARGETS.muted),
    "--ui-text-faint": ink(INK_TARGETS.faint),

    "--ui-hairline": hairline(8),
    "--ui-hairline-strong": hairline(15),

    "--ui-accent": accentCss,
    "--ui-accent-dim": accentDim,
    "--ui-accent-wash": `color-mix(in oklab, ${accentCss} 14%, transparent)`,
    // What is legible *on* the accent — the active find match paints text on it.
    // Derived for the same reason a mark's ink is: nothing can stop a theme
    // choosing an accent this build has never seen.
    "--ui-accent-ink": readableInk(accentCss) ?? "#000000",

    "--ui-danger": dangerCss,
    // The close button fills with danger and draws its glyph on top. That glyph
    // was `white`, which is right on a dark rail and wrong the moment danger has
    // to be light enough to read on a bright one.
    "--ui-danger-ink": readableInk(dangerCss) ?? "#ffffff",

    // The seam's inward shadow, which says the canvas is a sheet lying on the
    // rail. Fixed at 45% black it was tuned for a dark tool, where a shadow is
    // most of what separates two near-black planes. On a light tool the same
    // value reads as grime along the edge, so the shadow follows the material:
    // deep where the depth has to be felt, barely there where the hairline is
    // already doing the work.
    "--ui-seam-shadow": `rgb(0 0 0 / ${onLight ? "0.12" : "0.45"})`,
  };
}

/** Writes the chrome onto an element. The mirror of `applyTheme`, and separate
 *  from it because the two write different namespaces onto different elements —
 *  the paper onto the canvas, the tool onto the root. */
export function applyChrome(theme: Theme, element: HTMLElement): void {
  for (const [property, value] of Object.entries(chromeTokens(theme))) {
    element.style.setProperty(property, value);
  }
}
