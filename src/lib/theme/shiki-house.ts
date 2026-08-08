import type { ThemeRegistrationRaw } from "shiki";

/**
 * The syntax themes that are ours rather than Shiki's.
 *
 * Every other preset points at the authentic VS Code theme of the same name.
 * House needs its own, because a borrowed one always reads as a foreign object
 * dropped into the page: it carries a different grey, a different saturation and
 * a different idea of what a comment looks like. These colors are drawn from the
 * same warm-ink family as the House prose palette, so a code block sits *in* the
 * document rather than on top of it.
 *
 * Colorblind Safe needs its own for a harder reason — see `CVD_LIGHT` below.
 * Every theme in Shiki's bundle picks its scope colors on the assumption that
 * red and green are two colors.
 *
 * Deliberately a short scope list. A TextMate theme with 200 rules is a theme
 * nobody can adjust; these twelve cover what the grammars actually emit.
 */

const LIGHT = {
  fg: "#3a3226", // the House ink, one step warmer for a smaller size
  comment: "#8c8371",
  string: "#4b7a3f", // moss
  keyword: "#9a4f2a", // burnt sienna
  func: "#2c6f7d", // the House link teal, darkened to hold at 15px
  constant: "#7a5aa0", // plum
  type: "#8a6414", // ochre
  punctuation: "#857c6a",
  invalid: "#b3261e",
  bg: "oklch(0.955 0.007 85)", // matches --doc-code-bg for House Light
} as const;

const DARK = {
  fg: "#d8d2c6",
  comment: "#7e7a72",
  string: "#a3c48a",
  keyword: "#e29a6a",
  func: "#7fc4d4",
  constant: "#c3a6e8",
  type: "#e8c07a",
  punctuation: "#9a948a",
  invalid: "#f2837b",
  bg: "oklch(0.22 0.010 250)", // matches --doc-code-bg for House Dark
} as const;

/**
 * The syntax palette for Colorblind Safe.
 *
 * A code theme is the hardest place in the app to get this right, and the
 * reason none of Shiki's bundled themes could be pointed at instead. Prose has
 * two or three colours in it; a fence has eight at once, in short runs at 15px,
 * and the reader is being asked to tell a type from a keyword *by colour* on a
 * line where nothing else distinguishes them. Every bundled theme spends its
 * budget the same way — a red keyword next to a green string — which is the one
 * pair that does not survive the most common deficiency there is.
 *
 * So these six hues were fitted rather than chosen: spread around the wheel,
 * held to a 4.5:1 band against the code background so none of them is a whisper
 * on the page, and then checked pairwise under simulated protanopia,
 * deuteranopia and tritanopia. `cvd.test.ts` holds them to the same floor as
 * the alerts. Adjust one by eye and that test is what tells you which other
 * five you just broke.
 *
 * `comment` and `punctuation` stay grey on purpose. They are the two scopes
 * that want to recede, and spending a distinguishable hue on either would mean
 * one fewer for the scopes a reader is actually comparing.
 */
const CVD_LIGHT = {
  fg: "#1a1a1a",
  comment: "#595959",
  string: "#154c2f",
  keyword: "#8e0c01",
  func: "#3b62b7",
  constant: "#85058a",
  type: "#8d6520",
  punctuation: "#6b6b6b",
  invalid: "#c02389",
  bg: "#f2f2f2",
} as const;

const CVD_DARK = {
  fg: "#e8e8e8",
  comment: "#9a9a9a",
  string: "#6ede80",
  keyword: "#ee7c11",
  func: "#428dd4",
  constant: "#cdaaf6",
  type: "#f1b83b",
  punctuation: "#8f8f8f",
  invalid: "#fe3e5b",
  bg: "#1e1e1e",
} as const;

/** The twelve slots `build` colors. Named so a second palette can fill them. */
type SyntaxPalette = { readonly [K in keyof typeof LIGHT]: string };

function build(name: string, type: "light" | "dark", c: SyntaxPalette): ThemeRegistrationRaw {
  return {
    name,
    type,
    bg: c.bg,
    fg: c.fg,
    settings: [
      { settings: { background: c.bg, foreground: c.fg } },
      {
        // Italic comments are the one stylistic flourish here, and the reason
        // the bundled serif/mono faces are loaded with an italic axis.
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: c.comment, fontStyle: "italic" },
      },
      {
        scope: ["string", "constant.other.symbol", "meta.embedded.assembly"],
        settings: { foreground: c.string },
      },
      {
        scope: ["constant.numeric", "constant.language", "constant.character"],
        settings: { foreground: c.constant },
      },
      {
        scope: ["keyword", "storage", "storage.type", "keyword.operator.new"],
        settings: { foreground: c.keyword },
      },
      {
        scope: ["entity.name.function", "support.function", "meta.function-call"],
        settings: { foreground: c.func },
      },
      {
        scope: [
          "entity.name.type",
          "entity.name.class",
          "support.type",
          "support.class",
          "entity.other.inherited-class",
        ],
        settings: { foreground: c.type },
      },
      {
        scope: ["variable", "variable.other", "meta.definition.variable"],
        settings: { foreground: c.fg },
      },
      {
        scope: ["variable.parameter", "variable.other.member"],
        settings: { foreground: c.func },
      },
      {
        scope: ["entity.name.tag", "punctuation.definition.tag"],
        settings: { foreground: c.keyword },
      },
      {
        scope: ["entity.other.attribute-name", "support.type.property-name"],
        settings: { foreground: c.type },
      },
      {
        scope: ["punctuation", "meta.brace", "keyword.operator", "punctuation.separator"],
        settings: { foreground: c.punctuation },
      },
      {
        scope: ["string.regexp", "constant.character.escape"],
        settings: { foreground: c.string },
      },
      {
        scope: ["markup.heading", "entity.name.section"],
        settings: { foreground: c.func, fontStyle: "bold" },
      },
      {
        scope: ["markup.inserted", "markup.deleted", "markup.changed"],
        settings: { foreground: c.string },
      },
      {
        scope: ["invalid", "invalid.illegal"],
        settings: { foreground: c.invalid },
      },
    ],
  };
}

export const HOUSE_LIGHT = build("lindo-md-house-light", "light", LIGHT);
export const HOUSE_DARK = build("lindo-md-house-dark", "dark", DARK);
export const CVD_SAFE_LIGHT = build("lindo-md-cvd-light", "light", CVD_LIGHT);
export const CVD_SAFE_DARK = build("lindo-md-cvd-dark", "dark", CVD_DARK);

/** The two palettes above, before `build` scatters them across TextMate scopes.
 *  Exported for `cvd.test.ts`, which checks the claim the theme's name makes. */
export const CVD_SYNTAX = { light: CVD_LIGHT, dark: CVD_DARK };

/** Ids that must be registered from these objects rather than fetched from
 *  Shiki's bundle. `lib/render/shiki.ts` checks against this map. */
export const HOUSE_THEMES: Record<string, ThemeRegistrationRaw> = {
  "lindo-md-house-light": HOUSE_LIGHT,
  "lindo-md-house-dark": HOUSE_DARK,
  "lindo-md-cvd-light": CVD_SAFE_LIGHT,
  "lindo-md-cvd-dark": CVD_SAFE_DARK,
};
