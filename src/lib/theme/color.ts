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
