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
    // A grid draws a rule to the left of every cell but the first, so every cell
    // needs the gutter — not only the outer two, which is all this used to give
    // and why a gridded table read as text jammed up against a line.
    "--doc-table-pad-start": layout.table.rules === "grid" ? "var(--doc-table-pad-inline)" : "0px",
    "--doc-table-pad-edge": layout.table.rules === "grid" ? "var(--doc-table-pad-inline)" : "0px",
    "--doc-table-stripe": layout.table.zebra
      ? "color-mix(in oklab, var(--doc-surface) 60%, transparent)"
      : "transparent",

    "--doc-code-wrap": theme.code.wrap ? "pre-wrap" : "pre",
  };

  HEADING_EXPONENTS.forEach((exponent, index) => {
    tokens[`--doc-h${index + 1}`] = `${round(Math.pow(type.scale, exponent))}em`;
  });

  return { ...tokens, ...componentTokens(theme) };
}

/**
 * The colours a highlight can be painted in.
 *
 * Split out of `docTokens` for the same reason `viewTokens` is — so the split is
 * enforced rather than remembered — but the split here is a different one. These
 * are `--doc-*` because a highlight is on the paper, not on the tool: it is
 * content the reader added, and it exports into the Markdown. They are **not**
 * drawn from the theme, which every other `--doc-*` value is.
 *
 * That is a deliberate, reversible shortcut. Making them theme fields means a
 * required five colours in `ThemeColorsSchema`, which is twenty presets times two
 * halves to fill in and five more decisions for anyone authoring a theme — for a
 * palette that has no UI to change it yet. Promoting them later is an optional
 * schema field whose default is exactly what is written here.
 *
 * **A mark is opaque and carries its own ink, and that is what makes one palette
 * safe on twenty presets.** The first version washed a translucent colour over
 * the page and let the theme's own text show through, which reads well on paper
 * the colour of paper and fails on dark themes: the wash lifts the background
 * towards the light text sitting on it, and on Solarized Dark it took a 5.61:1
 * body contrast down to 2.44:1. Compositing over an unknown background can only
 * ever be argued preset by preset, and there are forty halves to argue. Painting
 * the background *and* the ink makes the contrast a property of this function
 * alone — 8.65:1 at worst, whatever the paper — and `theme.test.ts` checks both
 * that and visibility against every preset rather than trusting this paragraph.
 * `::highlight(lindo-md-find-active)` in `styles.css` already worked this way.
 *
 * The names are slots, not descriptions. What `annotations.rs` stores is which
 * slot a mark uses, so re-theming these values re-paints existing marks instead
 * of stranding them on a colour that no longer belongs to the page.
 */
export function markTokens(): Record<string, string> {
  return {
    "--doc-mark-yellow": "oklch(0.88 0.15 95)",
    "--doc-mark-green": "oklch(0.86 0.14 148)",
    "--doc-mark-blue": "oklch(0.85 0.1 235)",
    "--doc-mark-pink": "oklch(0.84 0.11 5)",
    "--doc-mark-purple": "oklch(0.82 0.11 305)",
    // The ink every mark is read in. Near-black rather than the theme's own text
    // colour, because the whole point is that the pair is fixed.
    "--doc-mark-ink": "oklch(0.26 0.015 60)",
  };
}

/** The slot names, in the order the menu offers them. */
export const MARK_SLOTS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type MarkSlot = (typeof MARK_SLOTS)[number];

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
  for (const [property, value] of Object.entries(markTokens())) {
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
 * The component choices, as tokens.
 *
 * These were `data-*` attributes at first, which read better — `[data-quote="hang"]`
 * says what it selects, and `document.css` stayed the only place that knew what a
 * hanging quotation looks like. It was wrong, and the way it was wrong is worth
 * recording because the same trap is open to anything else keyed on an attribute.
 *
 * `applyTheme` writes onto the document *canvas*, not onto `documentElement` —
 * `useTheme` passes the canvas, the drawer's previews pass a card, and the
 * specimen passes twenty of them. Meanwhile `index.html` carried House's defaults
 * so the first paint had something to match. So two ancestors of the same `.doc`
 * both carried the attributes, both selectors matched at identical specificity,
 * and CSS breaks that tie by source order rather than by proximity. The variants
 * did not override each other; their properties unioned. Every non-House theme
 * drew its own quotation *and* House's, and the fill from a card sat underneath
 * the left rule of a flush code block.
 *
 * Custom properties do not have that problem: they inherit, so the nearest
 * themed ancestor wins, which is exactly what "this element is themed" should
 * mean. Nesting a theme inside a theme now works by construction rather than by
 * everyone remembering that it must not happen.
 *
 * The cost is that a variant states every property in its group, including the
 * ones it is turning off. That is the tax for inheritance being the mechanism,
 * and it is paid here rather than in the stylesheet.
 */
function componentTokens(theme: Theme): Record<string, string> {
  const { heading, quote, rule, code, alert, list, tableHead, image } = theme.components;

  const headingRule = (level: "h1" | "h2") => {
    const on = heading.rule === level || heading.rule === "h1-h2";
    return {
      [`--doc-${level}-rule`]: on ? "1px" : "0px",
      [`--doc-${level}-rule-gap`]: on ? (level === "h1" ? "0.28em" : "0.26em") : "0em",
    };
  };

  const MINOR = {
    uppercase: { transform: "uppercase", caps: "normal", tracking: "0.04em" },
    "small-caps": { transform: "none", caps: "all-small-caps", tracking: "0.03em" },
    normal: { transform: "none", caps: "normal", tracking: "0em" },
  }[heading.minor];

  /**
   * Every quotation is tinted, whichever style it is.
   *
   * That is a rule about quotations rather than a property of any one style, so
   * it is written once here instead of four times in the table below — four
   * copies of a rule is four places for it to stop being true. The styles differ
   * in what they add to the tint: a rule, a radius, a displacement.
   *
   * The reasoning is the same one that put a fill on the hanging quote first. A
   * quotation marked only by being italic, or larger, or slightly outdented, does
   * not read as a quotation — it reads as an emphatic paragraph, and the reader
   * has to work out which from the words. The tint is what says "this is not the
   * author talking", and it should not be optional.
   *
   * `--doc-surface` rather than a mix of the text colour: every palette already
   * defines a raised plane distinct from its page, and it is what the callout,
   * the details block and the diagram frame all sit on.
   */
  const QUOTE_FILL = "var(--doc-surface)";

  // `inset` is `block inline`, or `block inline-end block inline-start` where the
  // two sides differ. Every style now pads on all four, because a tint with text
  // against its edge is worse than no tint.
  const QUOTE = {
    bar: {
      outdent: "0em",
      inset: "0.8em 1.1em",
      rule: "2px",
      // Square against the rule, rounded away from it — the rule is an edge, so
      // rounding it would leave a bar with two little tails.
      radius: "0 6px 6px 0",
      ink: "var(--doc-text-muted)",
      style: "italic",
      size: "1em",
    },
    hang: {
      // The tint says "a quotation"; the outdent and the size are what keep this
      // from being the card.
      outdent: "-1.2em",
      inset: "0.9em 1.1em 0.9em 1.2em",
      rule: "0px",
      radius: "6px",
      ink: "var(--doc-text)",
      style: "italic",
      size: "1.08em",
    },
    card: {
      outdent: "0em",
      inset: "0.9em 1.1em",
      rule: "0px",
      radius: "8px",
      ink: "var(--doc-text-muted)",
      style: "normal",
      size: "1em",
    },
    // A flat band: the tint and nothing else. No rule, no corners, no
    // displacement — the quiet end of the range, but still marked.
    plain: {
      outdent: "0em",
      inset: "0.8em 1.1em",
      rule: "0px",
      radius: "0px",
      ink: "var(--doc-text-muted)",
      style: "italic",
      size: "1em",
    },
  }[quote];

  const HR = {
    line: { height: "1px", fill: "var(--doc-border)", width: "100%", align: "0", mark: '""' },
    short: { height: "1px", fill: "var(--doc-border)", width: "5em", align: "auto", mark: '""' },
    space: { height: "0px", fill: "none", width: "100%", align: "0", mark: '""' },
    asterism: { height: "auto", fill: "none", width: "100%", align: "0", mark: '"⁂"' },
  }[rule];

  const CODE_BLOCK = {
    card: {
      radius: "8px",
      fill: "var(--doc-code-bg)",
      ring: "1px",
      rule: "0px",
      inset: "1em 1.1em",
    },
    framed: { radius: "8px", fill: "transparent", ring: "1px", rule: "0px", inset: "1em 1.1em" },
    flush: {
      radius: "0px",
      fill: "transparent",
      ring: "0px",
      rule: "2px",
      inset: "1em 0 1em 1.1em",
    },
  }[code.block];

  const CODE_INLINE = {
    tint: {
      fill: "var(--doc-code-bg)",
      ring: "1px",
      inset: "0.15em 0.35em",
      ink: "inherit",
    },
    outline: { fill: "transparent", ring: "1px", inset: "0.15em 0.35em", ink: "inherit" },
    bare: { fill: "transparent", ring: "0px", inset: "0em 0.1em", ink: "var(--doc-accent)" },
  }[code.inline];

  const ALERT = {
    bar: {
      rule: "3px",
      radius: "0 6px 6px 0",
      fill: "color-mix(in oklab, var(--alert-color) 7%, var(--doc-bg))",
      ring: "0px",
      inset: "0.9em 1.1em",
    },
    card: {
      rule: "0px",
      radius: "8px",
      fill: "color-mix(in oklab, var(--alert-color) 8%, var(--doc-bg))",
      ring: "1px",
      inset: "0.9em 1.1em",
    },
    minimal: {
      rule: "0px",
      radius: "0px",
      fill: "transparent",
      ring: "0px",
      inset: "0.2em 0em",
    },
  }[alert];

  // `list-style-type` accepts a string, so the dash is a marker in the same sense
  // `disc` is — positioned and aligned by the list rather than by a pseudo-element
  // this file would have to place by hand.
  //
  // The en dash and the two spaces after it are literal characters rather than
  // the CSS escapes a backslash would introduce. `applyTheme` writes this through
  // `setProperty`, which re-escapes the backslash and puts "a0a0" on the page.
  const LIST = {
    default: { pad: "1.4em", style: "disc", hang: "0em" },
    dash: { pad: "1.4em", style: '"–  "', hang: "0em" },
    // The marker hangs in the gutter, so the list's text edge lines up with the
    // paragraphs above it rather than being indented past them.
    outdent: { pad: "0em", style: "disc", hang: "1.4em" },
  }[list];

  const TABLE_HEAD = {
    uppercase: {
      transform: "uppercase",
      tracking: "0.04em",
      size: "0.85em",
      ink: "var(--doc-text-muted)",
    },
    sentence: { transform: "none", tracking: "0em", size: "0.92em", ink: "var(--doc-heading)" },
  }[tableHead];

  return {
    ...headingRule("h1"),
    ...headingRule("h2"),
    "--doc-heading-tracking": `${heading.tracking}em`,
    "--doc-heading-leading": `${heading.leading}`,
    "--doc-h6-transform": MINOR.transform,
    "--doc-h6-caps": MINOR.caps,
    "--doc-h6-tracking": MINOR.tracking,

    "--doc-quote-outdent": QUOTE.outdent,
    "--doc-quote-inset": QUOTE.inset,
    "--doc-quote-rule": QUOTE.rule,
    "--doc-quote-radius": QUOTE.radius,
    "--doc-quote-fill": QUOTE_FILL,
    "--doc-quote-ink": QUOTE.ink,
    "--doc-quote-style": QUOTE.style,
    "--doc-quote-size": QUOTE.size,

    "--doc-hr-height": HR.height,
    "--doc-hr-fill": HR.fill,
    "--doc-hr-width": HR.width,
    "--doc-hr-align": HR.align,
    "--doc-hr-mark": HR.mark,

    "--doc-code-radius": CODE_BLOCK.radius,
    "--doc-code-fill": CODE_BLOCK.fill,
    "--doc-code-ring": CODE_BLOCK.ring,
    "--doc-code-rule": CODE_BLOCK.rule,
    "--doc-code-inset": CODE_BLOCK.inset,

    "--doc-code-inline-fill": CODE_INLINE.fill,
    "--doc-code-inline-ring": CODE_INLINE.ring,
    "--doc-code-inline-inset": CODE_INLINE.inset,
    "--doc-code-inline-ink": CODE_INLINE.ink,

    "--doc-alert-rule": ALERT.rule,
    "--doc-alert-radius": ALERT.radius,
    "--doc-alert-fill": ALERT.fill,
    "--doc-alert-ring": ALERT.ring,
    "--doc-alert-inset": ALERT.inset,

    "--doc-list-pad": LIST.pad,
    "--doc-list-style": LIST.style,
    "--doc-list-hang": LIST.hang,

    "--doc-th-transform": TABLE_HEAD.transform,
    "--doc-th-tracking": TABLE_HEAD.tracking,
    "--doc-th-size": TABLE_HEAD.size,
    "--doc-th-ink": TABLE_HEAD.ink,

    "--doc-image-radius": `${image.radius}px`,
    "--doc-image-frame": image.frame ? "var(--doc-border)" : "transparent",
  };
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
