/**
 * Colour conversion to `#rrggbb`.
 *
 * Two things in the app cannot take a modern CSS colour and have to be handed
 * hex, which is why this exists rather than leaving it to the browser:
 *
 *  - **Mermaid** parses its `themeVariables` with a library that only knows
 *    hex/rgb/hsl. Handed an `oklch()` it throws `Unsupported color format`, and
 *    every diagram in a theme authored in oklch — including House — fails.
 *  - **`<input type="color">`** accepts `#rrggbb` and nothing else, so the
 *    colour pickers in the settings drawer would all read black.
 *
 * Converted here rather than through a DOM probe because `getComputedStyle` in
 * Chromium preserves the authored colour space (an `oklch()` in is an `oklch()`
 * out), so probing solves nothing — and because a pure function is testable.
 */

/** Any CSS colour we might be handed, reduced to `#rrggbb`. Returns `fallback`
 *  for anything unrecognized — a colour we cannot read is not worth throwing
 *  over, and every caller has a sane default. */
export function toHex(value: string, fallback = "#000000"): string {
  const input = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(input)) return input.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(input)) {
    // Indexed rather than spread: the regex above guarantees three ASCII hex
    // digits, and spreading a string is a code-point operation the linter rightly
    // flags as unsafe for the general case.
    const [r, g, b] = [input[1], input[2], input[3]];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(input);
  if (rgb) {
    return channelsToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  }

  const oklch = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.-]+)(?:deg)?/i.exec(input);
  if (oklch) {
    const lightness = percentOr(oklch[1]!, 1);
    const chroma = percentOr(oklch[2]!, 0.4);
    const hue = Number(oklch[3]);
    return oklchToHex(lightness, chroma, hue);
  }

  return fallback;
}

/**
 * The same conversion, but `null` rather than a guess when the value is not one
 * this parser understands, or when it carries alpha.
 *
 * `toHex`'s fallback is right for its original callers — Mermaid and a colour
 * input both need *a* colour and have a sane default — and catastrophic for a
 * caller reasoning about contrast, because an unreadable pair and an unparseable
 * one both come back as black. A theme may legally say `white`, `hsl(60 100%
 * 50%)`, `color-mix(in oklab, white 90%, black)` or `var(--doc-bg)`: every one of
 * those used to report luminance 0, so `readableInk` chose the *light* ink while
 * the real, near-white ground was painted underneath it. The guarantee said
 * 19.29:1 and the reader got about 1.02:1.
 *
 * Alpha is refused rather than ignored for the same reason. `rgba(255,255,0,0.05)`
 * is a 5% wash over the paper, so its contrast is the paper's business again —
 * which is the whole failure opacity was adopted to end.
 */
export function toHexStrict(value: string): string | null {
  const input = value.trim();

  // Four- and eight-digit hex carry alpha; three and six do not.
  if (/^#[0-9a-f]{6}$/i.test(input) || /^#[0-9a-f]{3}$/i.test(input)) return toHex(input);
  if (/^#[0-9a-f]{4}$/i.test(input) || /^#[0-9a-f]{8}$/i.test(input)) return null;

  const rgb =
    /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*([,/]\s*([\d.]+%?)\s*)?\)$/i.exec(
      input,
    );
  if (rgb) {
    if (rgb[5] !== undefined && !isOpaque(rgb[5])) return null;
    // Percentage channels are legal and `toHex` does not read them.
    if ([rgb[1], rgb[2], rgb[3]].some((c) => c?.endsWith("%"))) {
      return channelsToHex(
        ...([rgb[1], rgb[2], rgb[3]].map((c) => percentOr(c!, 255)) as [number, number, number]),
      );
    }
    return toHex(input);
  }

  const oklch =
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.-]+)(deg)?\s*(\/\s*([\d.]+%?)\s*)?\)$/i.exec(input);
  if (oklch) {
    if (oklch[6] !== undefined && !isOpaque(oklch[6])) return null;
    return toHex(input);
  }

  // Named colours, `color-mix()`, `var()`, `hsl()`, `oklch(from …)`, and hues in
  // turns or radians all land here. Legal CSS, and not something this file can
  // reason about — so it says so instead of guessing.
  return null;
}

/** Alpha of 1 (or 100%) only. Anything else composites over the page. */
function isOpaque(alpha: string): boolean {
  return percentOr(alpha, 1) >= 1;
}

/** `50%` means half of `full`; a bare number is already in the right unit. */
function percentOr(token: string, full: number): number {
  return token.endsWith("%") ? (Number(token.slice(0, -1)) / 100) * full : Number(token);
}

/**
 * Oklch → sRGB, by way of Oklab and linear sRGB. Coefficients are Björn
 * Ottosson's from the Oklab reference implementation.
 */
function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return channelsToHex(
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
  );
}

/** Linear sRGB → sRGB transfer function. */
function gamma(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

function channelsToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(toByte).join("")}`;
}

function toByte(channel: number): string {
  // A wide-gamut oklch can land outside sRGB; clamping is the standard
  // treatment and matches what the browser paints.
  const clamped = Math.min(255, Math.max(0, Math.round(channel)));
  return clamped.toString(16).padStart(2, "0");
}

/** A colour in Oklch, as `oklch()` writes it: lightness 0–1, chroma, hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/**
 * The inverse of the conversion above: any CSS colour this file can read, in
 * Oklch.
 *
 * Here because the chrome is derived from the paper (`chrome.ts`), and deriving
 * means arithmetic on lightness and chroma — "a step away from the ground",
 * "the same hue, quieter". A theme states its colours as strings in whatever
 * notation its author preferred, so there has to be a way back into numbers.
 *
 * `null` for anything unreadable, for the same reason `toHexStrict` returns it:
 * a caller reasoning about contrast cannot be handed a guess.
 */
export function toOklch(value: string): Oklch | null {
  const hex = toHexStrict(value);
  if (hex === null) return null;

  const linear = (at: number) => {
    const raw = parseInt(hex.slice(at, at + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [linear(1), linear(3), linear(5)];

  // Ottosson's matrix again, the other way round: linear sRGB → LMS, cube root
  // into the perceptual space, then LMS → Oklab.
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return {
    l: lightness,
    c: Math.hypot(a, bb),
    h: hue < 0 ? hue + 360 : hue,
  };
}

/** An `Oklch` back to the CSS the browser is handed. Rounded, because these end
 *  up in a stylesheet a person may read. */
export function oklchCss({ l, c, h }: Oklch): string {
  const round = (value: number, places: number) => Number(value.toFixed(places));
  return `oklch(${round(Math.min(1, Math.max(0, l)), 4)} ${round(Math.max(0, c), 4)} ${round(h, 2)})`;
}

/**
 * WCAG relative-luminance contrast ratio between two CSS colours, 1 to 21.
 *
 * Here because a highlight has to stay readable on paper this code has never
 * seen: a theme is a file people share, so the colours a mark is painted in are
 * not known when this is written. Checking is the only alternative to trusting.
 */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

/** The inks a highlight is read in. Near rather than pure, so a mark does not
 *  out-contrast the body text around it. */
const INK_DARK = "oklch(0.26 0.015 60)";
const INK_LIGHT = "oklch(0.97 0.005 85)";

/** The bar body text has to clear, from WCAG AA. */
const READABLE = 4.5;

/**
 * Whichever ink reads better on `ground`.
 *
 * Derived rather than fixed, and that is what makes a themeable highlight safe.
 * A theme supplies the colour a mark is painted in; nothing can stop it choosing
 * one this code has never seen, and a fixed ink would then be a guess that
 * happens to suit the palette that shipped.
 *
 * The softened inks are tried first because they are what a mark should look
 * like, and pure black or white is the fallback for a ground neither can carry.
 * A mid-grey is roughly where the softened pair bottoms out, at about 3.95:1 —
 * the true minimum is 3.79:1 near L 0.205 — so the fallback is what keeps the
 * promise. Pure black and white always leave one option at 4.58:1 or better:
 * that is the worst point of `max((L + 0.05) / 0.05, 1.05 / (L + 0.05))`, at
 * L ≈ 0.179. The guarantee therefore holds for every colour anyone can write.
 *
 * `null` for a ground this file cannot read. There is no ink that is provably
 * safe on an unknown colour, and answering anyway is what made the old
 * guarantee false — `ThemeColorsSchema` refuses such a colour for a mark before
 * it can reach here, and this returning `null` is what makes that refusal the
 * only way through rather than merely the usual one.
 */
export function readableInk(ground: string): string | null {
  const hex = toHexStrict(ground);
  if (hex === null) return null;

  const softer =
    contrastRatio(hex, INK_DARK) >= contrastRatio(hex, INK_LIGHT) ? INK_DARK : INK_LIGHT;
  if (contrastRatio(hex, softer) >= READABLE) return softer;
  return contrastRatio(hex, "#000000") >= contrastRatio(hex, "#ffffff") ? "#000000" : "#ffffff";
}

/** Relative luminance of a CSS colour, per WCAG 2.x. Unparseable colours are the
 *  caller's problem — see `toHexStrict`; `contrastRatio` is only ever handed
 *  values that have already been through it. */
function luminance(value: string): number {
  const hex = toHexStrict(value) ?? "#000000";
  const channel = (at: number) => {
    const raw = parseInt(hex.slice(at, at + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
