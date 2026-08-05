import { toHex } from "./color";
import type { Theme } from "./schema";

/**
 * Turns a `Theme` into the `--doc-*` custom properties the document stylesheet
 * reads. This is the only place a theme becomes CSS.
 *
 * Two rules hold everything together (see DESIGN.md):
 *
 *  1. Every value here is a `--doc-*` property. A theme can never reach the
 *     chrome, so switching to a bright paper theme cannot wash out the rail.
 *  2. Every `--doc-*` property the stylesheet uses is produced here. If one were
 *     missing, it would silently fall back to the House default baked into
 *     `styles.css` and look almost right, which is the worst kind of bug.
 */

/** Heading sizes as exponents of the theme's modular scale.
 *
 * Not the textbook `s^5 … s^0`: a document viewer routinely shows h1–h4 in one
 * viewport, so the top of the ramp is compressed and the bottom lands just under
 * body size. With the House scale of 1.22 this gives 1.89 / 1.58 / 1.35 / 1.20 /
 * 1.06 / 0.92 em. */
const HEADING_EXPONENTS = [3.2, 2.3, 1.5, 0.9, 0.3, -0.4] as const;

export function docTokens(theme: Theme): Record<string, string> {
  const { colors, typography: type } = theme;

  const tokens: Record<string, string> = {
    "--doc-bg": colors.bg,
    "--doc-surface": colors.surface,
    "--doc-text": colors.text,
    "--doc-text-muted": colors.textMuted,
    "--doc-heading": colors.heading,
    "--doc-link": colors.link,
    "--doc-link-hover": colors.linkHover,
    "--doc-border": colors.border,
    "--doc-code-bg": colors.codeBg,
    "--doc-code-border": colors.codeBorder,
    "--doc-accent": colors.accent,
    "--doc-quote-bar": colors.quoteBar,
    "--doc-selection": colors.selection,

    "--doc-alert-note": colors.alert.note,
    "--doc-alert-tip": colors.alert.tip,
    "--doc-alert-important": colors.alert.important,
    "--doc-alert-warning": colors.alert.warning,
    "--doc-alert-caution": colors.alert.caution,

    "--doc-font-body": type.bodyFont,
    "--doc-font-heading": type.headingFont,
    "--doc-font-mono": type.monoFont,
    "--doc-size": `${type.baseSize}px`,
    "--doc-scale": `${type.scale}`,
    "--doc-leading": `${type.lineHeight}`,
    "--doc-measure": `${type.measure}ch`,
    "--doc-para-space": `${type.paragraphSpacing}em`,
    "--doc-tracking": `${type.letterSpacing}em`,
    "--doc-heading-weight": `${type.headingWeight}`,
    "--doc-align": type.justify ? "justify" : "start",
  };

  HEADING_EXPONENTS.forEach((exponent, index) => {
    tokens[`--doc-h${index + 1}`] = `${round(Math.pow(type.scale, exponent))}em`;
  });

  return tokens;
}

/** Two decimals is below the threshold where a font size difference is visible,
 *  and keeps the inspected style panel readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Writes the theme onto an element — the document canvas root, or a preview card
 * in the settings drawer, which is why the target is a parameter rather than
 * always `document.documentElement`.
 *
 * `zoom` scales the type here rather than in `docTokens`, and that placement is
 * the point: it is the reader's view setting, not part of the theme. Exported
 * HTML goes through `docTokens` alone, so a document exported while zoomed in
 * still carries the theme's own size.
 */
export function applyTheme(theme: Theme, target: HTMLElement, zoom = 1): void {
  for (const [property, value] of Object.entries(docTokens(theme))) {
    target.style.setProperty(property, value);
  }
  target.style.setProperty("--doc-size", `${round(theme.typography.baseSize * zoom)}px`);
  // Read by the code-block renderer for line numbers, and by `color-scheme` so
  // native form controls and scrollbars inside the document match the paper.
  target.dataset.appearance = theme.appearance;
  target.dataset.lineNumbers = String(theme.code.lineNumbers);
  target.style.colorScheme = theme.appearance;
}

/**
 * Mermaid cannot read CSS variables — it bakes colors into the SVG it generates.
 * Deriving its palette from the theme here is what makes diagrams recolor along
 * with the rest of the page instead of staying stuck on Mermaid's default blue.
 */
export function mermaidThemeVariables(theme: Theme): Record<string, string> {
  const { colors, typography: type } = theme;
  // Every colour goes through `toHex` first: Mermaid parses these with a library
  // that only knows hex/rgb/hsl, and an `oklch()` — which is how the House theme
  // is authored — makes it throw "Unsupported color format" and fail the whole
  // diagram. `color.test.ts` guards this for every preset.
  const c = (value: string, fallback: string) => toHex(value, fallback);
  const neutral = theme.appearance === "light" ? "#ffffff" : "#000000";
  const ink = theme.appearance === "light" ? "#000000" : "#ffffff";
  return {
    background: c(colors.bg, neutral),
    primaryColor: c(colors.surface, neutral),
    primaryTextColor: c(colors.text, ink),
    primaryBorderColor: c(colors.border, ink),
    secondaryColor: c(colors.codeBg, neutral),
    tertiaryColor: c(colors.bg, neutral),
    lineColor: c(colors.textMuted, ink),
    textColor: c(colors.text, ink),
    mainBkg: c(colors.surface, neutral),
    nodeBorder: c(colors.border, ink),
    clusterBkg: c(colors.bg, neutral),
    clusterBorder: c(colors.border, ink),
    edgeLabelBackground: c(colors.bg, neutral),
    titleColor: c(colors.heading, ink),
    noteBkgColor: c(colors.codeBg, neutral),
    noteTextColor: c(colors.text, ink),
    noteBorderColor: c(colors.border, ink),
    actorBkg: c(colors.surface, neutral),
    actorBorder: c(colors.border, ink),
    actorTextColor: c(colors.text, ink),
    signalColor: c(colors.text, ink),
    signalTextColor: c(colors.text, ink),
    labelBoxBkgColor: c(colors.surface, neutral),
    labelBoxBorderColor: c(colors.border, ink),
    labelTextColor: c(colors.text, ink),
    loopTextColor: c(colors.text, ink),
    // The heading face, not the body face. `themeVariables.fontFamily` wins over
    // the top-level `fontFamily` config, so this is the one that decides what
    // diagram labels are set in — and what Mermaid measures them with.
    fontFamily: type.headingFont,
    fontSize: `${Math.round(type.baseSize * 0.8)}px`,
  };
}
