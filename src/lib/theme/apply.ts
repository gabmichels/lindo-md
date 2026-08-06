import { toHex } from "./color";
import type { ContentWidth, Theme } from "./schema";

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

/**
 * The reader's view of the document, as opposed to the document's own design.
 *
 * Everything here is a window preference rather than a property of the paper —
 * it lives in settings, never in a theme, and never in an exported theme file.
 * `docTokens` deliberately does not see it (see `viewTokens`).
 */
export interface DocView {
  zoom: number;
  contentWidth: ContentWidth;
}

export const DEFAULT_VIEW: DocView = {
  zoom: 1,
  contentWidth: "standard",
};

/** `--doc-page` per setting. `wide` is one-and-a-half measures, which is the
 *  width at which a six-column table stops wrapping without the page reading as
 *  a spreadsheet. */
const PAGE_WIDTH: Record<ContentWidth, string> = {
  standard: "var(--doc-measure)",
  wide: "calc(var(--doc-measure) * 1.5)",
  full: "100%",
};

/**
 * The tokens that depend on the reader's view rather than on the theme.
 *
 * Split out from `docTokens` so the split is enforced rather than remembered:
 * a token in here cannot end up baked into a theme file.
 */
export function viewTokens(view: DocView): Record<string, string> {
  return { "--doc-page": PAGE_WIDTH[view.contentWidth] };
}

export function docTokens(theme: Theme): Record<string, string> {
  const { colors, typography: type, layout } = theme;
  const compactTable = layout.table.density === "compact";

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
    // An indented paragraph is its own separator; keeping the blank line as well
    // would say the same thing twice, so the indent suppresses it.
    "--doc-para-space": indented(type) ? "0em" : `${type.paragraphSpacing}em`,
    "--doc-indent": indented(type) ? "1.5em" : "0em",
    "--doc-tracking": `${type.letterSpacing}em`,
    "--doc-heading-weight": `${type.headingWeight}`,
    "--doc-align": type.justify ? "justify" : "start",
    "--doc-hyphens": type.hyphenate ? "auto" : "manual",
    "--doc-link-underline": type.linkUnderline === "always" ? "underline" : "none",
    "--doc-link-underline-hover": type.linkUnderline === "never" ? "none" : "underline",

    "--doc-pad-inline": `${layout.pagePadding}rem`,
    "--doc-table-pad-block": compactTable ? "0.3em" : "0.55em",
    "--doc-table-pad-inline": compactTable ? "0.6em" : "0.9em",
    // Hairline rules the rows only; a grid adds the vertical rules, and with
    // them the last column stops hanging flush to the text edge.
    "--doc-table-rule": layout.table.rules === "grid" ? "var(--doc-border)" : "transparent",
    "--doc-table-pad-last": layout.table.rules === "grid" ? "var(--doc-table-pad-inline)" : "0px",
    "--doc-table-stripe": layout.table.zebra
      ? "color-mix(in oklab, var(--doc-surface) 60%, transparent)"
      : "transparent",

    "--doc-code-wrap": theme.code.wrap ? "pre-wrap" : "pre",
  };

  HEADING_EXPONENTS.forEach((exponent, index) => {
    tokens[`--doc-h${index + 1}`] = `${round(Math.pow(type.scale, exponent))}em`;
  });

  return tokens;
}

function indented(type: Theme["typography"]): boolean {
  return type.paragraphStyle === "indented";
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
 * The view is applied here rather than in `docTokens`, and that placement is the
 * point: zoom and content width are the reader's settings, not part of the
 * theme. Exported HTML goes through `docTokens` alone, so a document exported
 * while zoomed in still carries the theme's own size.
 */
export function applyTheme(theme: Theme, target: HTMLElement, view: Partial<DocView> = {}): void {
  const resolved = { ...DEFAULT_VIEW, ...view };

  for (const [property, value] of Object.entries(docTokens(theme))) {
    target.style.setProperty(property, value);
  }
  for (const [property, value] of Object.entries(viewTokens(resolved))) {
    target.style.setProperty(property, value);
  }
  target.style.setProperty("--doc-size", `${round(theme.typography.baseSize * resolved.zoom)}px`);
  // Read by the code-block renderer for line numbers, and by `color-scheme` so
  // native form controls and scrollbars inside the document match the paper.
  target.dataset.appearance = theme.appearance;
  target.dataset.lineNumbers = String(theme.code.lineNumbers);
  // Heading numbers are CSS counters rather than a token, because a counter
  // cannot be expressed as a value the way every other setting here can.
  target.dataset.headingNumbers = String(theme.layout.numberHeadings);
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
