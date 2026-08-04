import type { ThemeRegistrationRaw } from "shiki";

/**
 * pretty-md's own syntax theme, in the two House appearances.
 *
 * Every other preset points at the authentic VS Code theme of the same name.
 * House needs its own, because a borrowed one always reads as a foreign object
 * dropped into the page: it carries a different grey, a different saturation and
 * a different idea of what a comment looks like. These colors are drawn from the
 * same warm-ink family as the House prose palette, so a code block sits *in* the
 * document rather than on top of it.
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

function build(
  name: string,
  type: "light" | "dark",
  c: typeof LIGHT | typeof DARK,
): ThemeRegistrationRaw {
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
        scope: [
          "punctuation",
          "meta.brace",
          "keyword.operator",
          "punctuation.separator",
        ],
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

export const HOUSE_LIGHT = build("pretty-md-house-light", "light", LIGHT);
export const HOUSE_DARK = build("pretty-md-house-dark", "dark", DARK);

/** Ids that must be registered from these objects rather than fetched from
 *  Shiki's bundle. `lib/render/shiki.ts` checks against this map. */
export const HOUSE_THEMES: Record<string, ThemeRegistrationRaw> = {
  "pretty-md-house-light": HOUSE_LIGHT,
  "pretty-md-house-dark": HOUSE_DARK,
};
