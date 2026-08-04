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

/** Any CSS color. Kept loose deliberately: presets are authored in oklch, users
 *  paste hex out of a palette, and both have to round-trip through an export. */
const color = z.string().min(1);

export const AppearanceSchema = z.enum(["light", "dark"]);
export type Appearance = z.infer<typeof AppearanceSchema>;

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
  bodyFont: z.string().min(1),
  headingFont: z.string().min(1),
  monoFont: z.string().min(1),
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
});
export type ThemeTypography = z.infer<typeof ThemeTypographySchema>;

export const ThemeCodeSchema = z.object({
  /** A Shiki theme id. `pretty-md-house-light` / `-dark` are ours, built from
   *  the House tokens so code reads as part of the page; everything else is the
   *  preset's authentic VS Code theme. */
  shikiTheme: z.string().min(1),
  lineNumbers: z.boolean(),
});
export type ThemeCode = z.infer<typeof ThemeCodeSchema>;

export const ThemeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  appearance: AppearanceSchema,
  colors: ThemeColorsSchema,
  typography: ThemeTypographySchema,
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
  format: z.literal("pretty-md-theme"),
  version: z.literal(1),
  theme: ThemeSchema,
});
export type ThemeFile = z.infer<typeof ThemeFileSchema>;
