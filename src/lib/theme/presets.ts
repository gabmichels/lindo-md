import { BUNDLED_FONTS } from "./fonts";
import { DEFAULT_COMPONENTS } from "./schema";
import type {
  Appearance,
  Theme,
  ThemeColors,
  ThemeComponents,
  ThemeLayout,
  ThemePreset,
  ThemeTypography,
} from "./schema";

/**
 * The built-in themes.
 *
 * Each preset is a light/dark pair presented as one choice — a reader picks
 * "Nord", not "Nord Dark", and the appearance setting decides which half shows.
 *
 * Palettes are the authentic ones wherever the theme has an official light and
 * dark half (GitHub, Solarized, One, Catppuccin, Gruvbox, Rosé Pine, Everforest).
 * Nord, Dracula and Tokyo Night are dark-first; their light halves are built from
 * the palette's own light shades — Nord's Snow Storm, Dracula's Alucard, Tokyo
 * Night Day — and the `note` says so.
 *
 * A preset chooses a palette, a code theme, a voice and a page. It used to choose
 * only the first two: eleven of the fifteen shared one typography set and all
 * fifteen shared one layout, so the entire difference between Nord and Everforest
 * was hue. Both are reading themes for people who like green or blue, and they
 * looked it. Everything below now states its own type and its own furniture, and
 * a preset that would be another palette on the same page does not earn a place.
 *
 * The reader can still override any of it — that is what the appearance drawer is
 * for. A preset is an opinion, not a cage.
 */

// --- typography -------------------------------------------------------------

/**
 * A bundled family, by the name the picker shows.
 *
 * Going through `BUNDLED_FONTS` rather than writing the font stack out means a
 * preset cannot name a face the app does not ship — the throw happens at module
 * load, so a typo is a failed build and not a page that silently falls back to
 * Georgia. It also guarantees the picker highlights the preset's own choice,
 * which needs the two strings to match exactly.
 */
function face(label: string): string {
  const font = BUNDLED_FONTS.find((entry) => entry.label === label);
  if (!font) throw new Error(`presets: "${label}" is not a bundled font`);
  return font.value;
}

/**
 * The shape every preset starts from — not a voice, just the fields that have to
 * have a value. Each preset overrides what it means to say.
 *
 * This used to be four shared sets, of which one covered eleven of the fifteen
 * presets. That is what made Nord and Everforest and Catppuccin the same page in
 * different colours. Every preset below now sets its own type.
 */
const BASE: ThemeTypography = {
  bodyFont: face("Source Serif 4"),
  headingFont: face("Inter Tight"),
  monoFont: face("JetBrains Mono"),
  baseSize: 19.5,
  scale: 1.22,
  lineHeight: 1.62,
  measure: 66,
  paragraphSpacing: 1.15,
  letterSpacing: 0,
  headingWeight: 600,
  justify: false,
  hyphenate: true,
  paragraphStyle: "spaced",
  linkUnderline: "always",
};

const LAYOUT: ThemeLayout = {
  pagePadding: 2,
  numberHeadings: false,
  table: { density: "comfortable", rules: "hairline", zebra: false },
};

/** Vertical rules, for the themes whose tables are scanned rather than read. */
const GRID_TABLES: ThemeLayout = {
  ...LAYOUT,
  table: { density: "comfortable", rules: "grid", zebra: false },
};

// --- component vocabularies --------------------------------------------------

/**
 * Named settings of the page's furniture, so a preset states a voice rather than
 * eleven fields. These are starting points: a preset spreads one and overrides
 * whatever its palette argues for.
 */

/** What the app has always drawn: barred quotes, filled code cards, ruled
 *  callouts, uppercase table heads. Right for a page that is mostly prose with
 *  code in it, which is what a README is. */
const PLAIN: ThemeComponents = DEFAULT_COMPONENTS;

/** The book: no rules anywhere they can be avoided, quotes displaced into the
 *  margin rather than marked, an asterism for a scene break, and code that sits
 *  in the text rather than in a box. */
const LITERARY: ThemeComponents = {
  ...PLAIN,
  heading: { rule: "none", tracking: -0.005, leading: 1.2, minor: "small-caps" },
  quote: "hang",
  rule: "asterism",
  code: { block: "flush", inline: "bare" },
  alert: "minimal",
  list: "dash",
  tableHead: "sentence",
  image: { radius: 4, frame: false },
};

/** The screen: tinted blocks, rounded corners, everything in a container. What a
 *  reader recognises from the app the palette came out of. */
const PANELLED: ThemeComponents = {
  ...PLAIN,
  heading: { rule: "none", tracking: -0.02, leading: 1.18, minor: "uppercase" },
  quote: "card",
  rule: "short",
  code: { block: "card", inline: "tint" },
  alert: "card",
  list: "default",
  tableHead: "uppercase",
  image: { radius: 10, frame: false },
};

/** Outlines instead of fills, hard edges, nothing tinted. For the palettes that
 *  are already saturated enough — a fill under a Gruvbox code block is a third
 *  shade of brown nobody asked for. */
const DRAWN: ThemeComponents = {
  ...PLAIN,
  heading: { rule: "none", tracking: -0.01, leading: 1.2, minor: "uppercase" },
  quote: "bar",
  rule: "line",
  code: { block: "framed", inline: "outline" },
  alert: "bar",
  list: "default",
  tableHead: "uppercase",
  image: { radius: 2, frame: true },
};

// --- the voices --------------------------------------------------------------

/**
 * One per preset, in the order the presets appear.
 *
 * Three things vary together and have to be chosen together: the face, the size
 * it is set at, and the measure it is set to. A face with a large x-height reads
 * at a smaller size and tolerates a longer line; an old-style face with a small
 * one needs the size back and the line shortened. Setting EB Garamond at Inter's
 * 17px over 76 characters — which is roughly what four shared sets forced — gives
 * a page that is technically Garamond and unreadable in practice.
 */

/** The House voice: serif body, sans headings. Editorial, and deliberately not
 *  Medium's — the pairing, the 1.22 scale and the 66ch measure are ours. */
const HOUSE_TYPE: ThemeTypography = { ...BASE };

/** github.com's own: system sans, 16px, and a long line. A README is scanned as
 *  much as read, and GitHub's page is built for that. */
const GITHUB_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Inter"),
  headingFont: face("Inter Tight"),
  baseSize: 16.5,
  lineHeight: 1.5,
  measure: 80,
  scale: 1.25,
  letterSpacing: -0.005,
};

/** One superfamily throughout. Solarized came out of a terminal, and Plex is the
 *  only bundled family with a serif, a sans and a mono drawn together — so the
 *  page can be technical without being three typefaces arguing. */
const PLEX_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("IBM Plex Serif"),
  headingFont: face("IBM Plex Sans"),
  monoFont: face("IBM Plex Mono"),
  baseSize: 18,
  lineHeight: 1.6,
  measure: 70,
  scale: 1.24,
};

/** Scandinavian flat: one grotesque, tight, wide, nothing decorative. */
const NORD_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Schibsted Grotesk"),
  headingFont: face("Schibsted Grotesk"),
  monoFont: face("Geist Mono"),
  baseSize: 17,
  lineHeight: 1.55,
  measure: 78,
  scale: 1.26,
  letterSpacing: -0.008,
};

/** The one theme allowed a personality face. Fraunces carries SOFT and WONK axes
 *  and a real display voice; Newsreader under it keeps the body readable, which a
 *  page set entirely in Fraunces would not be. */
const DRACULA_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Newsreader"),
  headingFont: face("Fraunces"),
  monoFont: face("Fira Code"),
  baseSize: 19,
  lineHeight: 1.6,
  measure: 64,
  scale: 1.3,
};

/** Atom's editor UI, which is where anyone who picks One has seen it. */
const ONE_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Inter"),
  headingFont: face("Inter Tight"),
  baseSize: 17,
  lineHeight: 1.55,
  measure: 76,
  letterSpacing: -0.005,
};

/** Neon geometry. Space Grotesk's headings are the theme's whole argument, so the
 *  scale is opened up to give them somewhere to be. */
const TOKYO_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Inter"),
  headingFont: face("Space Grotesk"),
  monoFont: face("Geist Mono"),
  baseSize: 17.5,
  lineHeight: 1.58,
  measure: 74,
  scale: 1.3,
  letterSpacing: -0.006,
};

/** Soft and round, and set loose. Catppuccin's palette is low-contrast on
 *  purpose; crowding it would undo the reason people choose it. */
const CATPPUCCIN_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Figtree"),
  headingFont: face("Figtree"),
  monoFont: face("Geist Mono"),
  baseSize: 17.5,
  lineHeight: 1.68,
  measure: 70,
  scale: 1.24,
  letterSpacing: -0.004,
};

/** A slab, because Gruvbox is a retro palette and a slab serif is the retro
 *  letterform — heavy, warm, and squared off the way the colours are. */
const GRUVBOX_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Bitter"),
  headingFont: face("Bitter"),
  monoFont: face("IBM Plex Mono"),
  baseSize: 18.5,
  lineHeight: 1.6,
  measure: 68,
  scale: 1.24,
  headingWeight: 700,
};

/** Faustina is high-contrast and slightly condensed, with an italic worth
 *  displaying — which is the point of pairing it with hanging quotations. */
const ROSE_PINE_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Faustina"),
  headingFont: face("Faustina"),
  baseSize: 20,
  lineHeight: 1.68,
  measure: 62,
  scale: 1.25,
};

/** Alegreya was drawn for long-form literary setting and has the calligraphic
 *  warmth Everforest's greens want. It runs light, so the headings take weight. */
const EVERFOREST_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Alegreya"),
  headingFont: face("Alegreya"),
  monoFont: face("IBM Plex Mono"),
  baseSize: 20,
  lineHeight: 1.66,
  measure: 64,
  scale: 1.26,
  headingWeight: 700,
};

/** An actual book. Garamond has a small x-height, so it goes up to 22px and the
 *  line comes in to 62 characters; the paragraphs indent instead of separating,
 *  the text justifies, and the links stop underlining. Every one of those is
 *  wrong for a README and right for a chapter. */
const PAPER_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("EB Garamond"),
  headingFont: face("EB Garamond"),
  monoFont: face("Source Code Pro"),
  baseSize: 22,
  lineHeight: 1.7,
  measure: 62,
  scale: 1.28,
  letterSpacing: 0.005,
  paragraphStyle: "indented",
  justify: true,
  hyphenate: true,
  linkUnderline: "hover",
};

/** Atkinson Hyperlegible Next was drawn by the Braille Institute to keep similar
 *  letterforms distinguishable. Paired with a large size and a short measure —
 *  the high-contrast palette is only half of legibility. */
const LEGIBLE_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Atkinson Hyperlegible"),
  headingFont: face("Atkinson Hyperlegible"),
  monoFont: face("IBM Plex Mono"),
  baseSize: 20,
  lineHeight: 1.7,
  measure: 60,
  scale: 1.24,
  headingWeight: 700,
};

/** Public Sans is a government typeface, drawn for documents that have to be
 *  read by everyone. The right register for the theme whose argument is that no
 *  reader should be shut out by a hue. */
const CVD_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Public Sans"),
  headingFont: face("Public Sans"),
  baseSize: 18,
  lineHeight: 1.62,
  measure: 70,
  scale: 1.24,
  headingWeight: 700,
};

/** Ayu is a modern, low-noise editor theme; Geist is the modern, low-noise
 *  grotesque, and its mono is drawn alongside it. */
const AYU_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Geist"),
  headingFont: face("Geist"),
  monoFont: face("Geist Mono"),
  baseSize: 17,
  lineHeight: 1.6,
  measure: 74,
  scale: 1.25,
  letterSpacing: -0.006,
};

/** Kanagawa is named for a woodblock print, and Literata — Google's own reading
 *  face, with an optical-size axis — is the one bundled serif quiet enough to sit
 *  under an ink-wash palette without arguing with it. */
const KANAGAWA_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Literata"),
  headingFont: face("Literata"),
  baseSize: 19,
  lineHeight: 1.66,
  measure: 66,
  scale: 1.24,
};

/** Vitesse is a reading-first editor theme, so this is the reading-first voice:
 *  Crimson Pro is an old-style face with a modern build, set large and quiet. */
const VITESSE_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Crimson Pro"),
  headingFont: face("Inter Tight"),
  monoFont: face("Geist Mono"),
  baseSize: 20.5,
  lineHeight: 1.65,
  measure: 66,
  scale: 1.22,
};

/** Material's own face is Roboto, which Google's licence keeps off this list.
 *  Source Sans 3 is the closest humanist sans we ship — same warmth, same open
 *  apertures — and it is otherwise unused, so Material is not a second Inter. */
const MATERIAL_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Source Sans 3"),
  headingFont: face("Source Sans 3"),
  monoFont: face("Fira Code"),
  baseSize: 17.5,
  lineHeight: 1.6,
  measure: 76,
  scale: 1.28,
};

/** Night Owl is a theme for reading at one in the morning, so it gets a serif —
 *  Lora, whose brushed terminals stay legible against a very dark ground where a
 *  fine-stroked face would bloom. */
const NIGHT_OWL_TYPE: ThemeTypography = {
  ...BASE,
  bodyFont: face("Lora"),
  headingFont: face("Inter Tight"),
  monoFont: face("Fira Code"),
  baseSize: 19,
  lineHeight: 1.64,
  measure: 68,
  scale: 1.24,
};

// --- derivation -------------------------------------------------------------

/** GitHub's alert hues, which are the de-facto standard for these five kinds and
 *  read correctly on every palette here. A preset may override them. */
const ALERTS = {
  light: {
    note: "#0969da",
    tip: "#1a7f37",
    important: "#8250df",
    warning: "#9a6700",
    caution: "#cf222e",
  },
  dark: {
    note: "#4493f8",
    tip: "#3fb950",
    important: "#ab7df8",
    warning: "#d29922",
    caution: "#f85149",
  },
} as const;

/**
 * The five alert hues, chosen to survive colour blindness.
 *
 * GitHub's set is green for tip and red for caution, and blue for note beside
 * purple for important. Both pairs collapse: to a deuteranope, red and green
 * differ by almost nothing, and purple is blue with the red taken out of it.
 * `cvd.test.ts` measures it — GitHub's worst pair is 9 units apart in simulated
 * deuteranopia, which is to say indistinguishable.
 *
 * Getting past that took giving up on hue as the only channel. Okabe–Ito's
 * eight-colour set is the usual answer, but its members sit at similar lightness
 * by design, and an alert colour here is also the title text — `document.css`
 * paints `.markdown-alert-title` with it — so every one of these has to clear
 * 4.5:1 against the page as well. Under that ceiling the Okabe–Ito hues bunch up
 * again. So these vary *lightness* as well as hue: a dark violet for important
 * against a mid blue for note, a light ochre for warning against a dark brick
 * for caution. Whatever the eye does to the hue, the two bars are still
 * different weights of ink.
 *
 * The floor the test holds them to is 25, against GitHub's 9. These reach 40
 * on the light half and 32 on the dark, which is the headroom to keep when
 * adjusting one.
 *
 * None of this makes colour the only signal: comrak writes the kind's name into
 * the callout, so "Warning" says so in words on every theme in the app. This
 * preset is about not making that the only thing the reader has.
 */
const CVD_ALERTS = {
  light: {
    note: "#2a6ed6", // mid blue
    tip: "#0d6b57", // deep green
    important: "#54169b", // violet, deliberately much darker than note
    warning: "#8d6a08", // ochre, deliberately much lighter than caution
    caution: "#9c1e0c", // brick
  },
  // Not the light hues lightened. Contrast runs the other way against a dark
  // ground, so the spread that separated them there had to be rebuilt here.
  dark: {
    note: "#7fa8ff",
    tip: "#35c9a4",
    important: "#b972f5",
    warning: "#e8a91e",
    caution: "#e0685c",
  },
} as const;

/** The nine colors a palette actually has to state. The rest are derived, which
 *  is what keeps 28 themes consistent instead of 28 independent guesses. */
interface Palette {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  heading: string;
  link: string;
  border: string;
  codeBg: string;
  /** Defaults to `link`; set it only when the palette has a distinct accent. */
  accent?: string;
}

function colorsFrom(
  palette: Palette,
  appearance: Appearance,
  alerts: ThemeColors["alert"] = ALERTS[appearance],
): ThemeColors {
  // Hover darkens on paper and lightens on a dark ground — the direction that
  // reads as "more", not "less", in each case.
  const toward = appearance === "light" ? "black" : "white";
  return {
    bg: palette.bg,
    surface: palette.surface,
    text: palette.text,
    textMuted: palette.muted,
    heading: palette.heading,
    link: palette.link,
    linkHover: `color-mix(in oklab, ${palette.link} 78%, ${toward})`,
    border: palette.border,
    codeBg: palette.codeBg,
    codeBorder: palette.border,
    accent: palette.accent ?? palette.link,
    quoteBar: palette.border,
    selection: `color-mix(in oklab, ${palette.link} 22%, transparent)`,
    alert: { ...alerts },
  };
}

function theme(
  id: string,
  name: string,
  appearance: Appearance,
  palette: Palette,
  shikiTheme: string,
  typography: ThemeTypography = BASE,
  alerts?: ThemeColors["alert"],
  components: ThemeComponents = DEFAULT_COMPONENTS,
  layout: ThemeLayout = LAYOUT,
): Theme {
  return {
    id,
    name,
    appearance,
    colors: colorsFrom(palette, appearance, alerts),
    typography,
    layout: { ...layout, table: { ...layout.table } },
    components: {
      ...components,
      heading: { ...components.heading },
      code: { ...components.code },
      image: { ...components.image },
    },
    code: { shikiTheme, lineNumbers: false, wrap: false },
  };
}

interface PresetSpec {
  id: string;
  name: string;
  note: string;
  typography?: ThemeTypography;
  /** How the page's furniture is drawn. Shared by both halves of a preset: a
   *  quotation does not change shape when the lights go out. */
  components?: ThemeComponents;
  /** Gutters and table shape. A preset may now set these — until the components
   *  group existed the comment here said a palette has no opinion about vertical
   *  rules, which was true of a palette and false of a theme: Colorblind Safe's
   *  whole argument is that colour must not be the only channel, and that is an
   *  argument about table rules as much as about hue. */
  layout?: ThemeLayout;
  /** Only Colorblind Safe sets these. GitHub's five hues are the default
   *  because they are what readers recognise, and a preset that replaces them
   *  is saying it has a reason the palette cannot express. */
  light: { palette: Palette; shiki: string; alerts?: ThemeColors["alert"] };
  dark: { palette: Palette; shiki: string; alerts?: ThemeColors["alert"] };
}

function preset(spec: PresetSpec): ThemePreset {
  const typography = spec.typography ?? BASE;
  const components = spec.components ?? DEFAULT_COMPONENTS;
  const layout = spec.layout ?? LAYOUT;
  return {
    id: spec.id,
    name: spec.name,
    note: spec.note,
    light: theme(
      `${spec.id}-light`,
      `${spec.name} Light`,
      "light",
      spec.light.palette,
      spec.light.shiki,
      typography,
      spec.light.alerts,
      components,
      layout,
    ),
    dark: theme(
      `${spec.id}-dark`,
      `${spec.name} Dark`,
      "dark",
      spec.dark.palette,
      spec.dark.shiki,
      typography,
      spec.dark.alerts,
      components,
      layout,
    ),
  };
}

// --- the presets ------------------------------------------------------------

export const PRESETS: ThemePreset[] = [
  preset({
    id: "house",
    name: "House",
    note: "lindo-md's own — warm bone paper, serif body, ink-teal links",
    typography: HOUSE_TYPE,
    components: PLAIN,
    light: {
      // Bone: paper white with a warm cast, never #fff. Ink: a warm near-black.
      palette: {
        bg: "oklch(0.985 0.004 85)",
        surface: "oklch(0.965 0.006 85)",
        text: "oklch(0.28 0.010 60)",
        muted: "oklch(0.52 0.012 60)",
        heading: "oklch(0.22 0.012 60)",
        link: "oklch(0.48 0.09 200)",
        border: "oklch(0.88 0.006 85)",
        codeBg: "oklch(0.955 0.007 85)",
      },
      shiki: "lindo-md-house-light",
    },
    dark: {
      palette: {
        bg: "oklch(0.185 0.008 250)",
        surface: "oklch(0.215 0.009 250)",
        text: "oklch(0.86 0.008 250)",
        muted: "oklch(0.65 0.010 250)",
        heading: "oklch(0.93 0.006 250)",
        link: "oklch(0.75 0.09 195)",
        border: "oklch(0.32 0.010 250)",
        codeBg: "oklch(0.22 0.010 250)",
      },
      shiki: "lindo-md-house-dark",
    },
  }),

  preset({
    id: "github",
    name: "GitHub",
    note: "What a README looks like on github.com",
    typography: GITHUB_TYPE,
    // The rule under h1 and h2 is the single most recognisable thing about a page
    // on github.com, and until the components group existed no theme could draw it.
    components: {
      ...PLAIN,
      heading: { rule: "h1-h2", tracking: -0.015, leading: 1.25, minor: "uppercase" },
      tableHead: "sentence",
    },
    light: {
      palette: {
        bg: "#ffffff",
        surface: "#f6f8fa",
        text: "#1f2328",
        muted: "#59636e",
        heading: "#1f2328",
        link: "#0969da",
        border: "#d1d9e0",
        codeBg: "#f6f8fa",
      },
      shiki: "github-light",
    },
    dark: {
      palette: {
        bg: "#0d1117",
        surface: "#151b23",
        text: "#e6edf3",
        muted: "#9198a1",
        heading: "#e6edf3",
        link: "#4493f8",
        border: "#3d444d",
        codeBg: "#151b23",
      },
      shiki: "github-dark",
    },
  }),

  preset({
    id: "github-dimmed",
    name: "GitHub Dimmed",
    note: "GitHub with the contrast taken off — easier for long sessions",
    typography: GITHUB_TYPE,
    // Deliberately identical to GitHub's. They are the same product with the
    // contrast taken off, and giving them different type would say otherwise.
    components: {
      ...PLAIN,
      heading: { rule: "h1-h2", tracking: -0.015, leading: 1.25, minor: "uppercase" },
      tableHead: "sentence",
    },
    light: {
      palette: {
        bg: "#f6f8fa",
        surface: "#ffffff",
        text: "#24292f",
        muted: "#57606a",
        heading: "#24292f",
        link: "#0969da",
        border: "#d0d7de",
        codeBg: "#ffffff",
      },
      shiki: "github-light-default",
    },
    dark: {
      palette: {
        bg: "#22272e",
        surface: "#2d333b",
        text: "#adbac7",
        muted: "#768390",
        heading: "#cdd9e5",
        link: "#539bf5",
        border: "#444c56",
        codeBg: "#2d333b",
      },
      shiki: "github-dark-dimmed",
    },
  }),

  preset({
    id: "solarized",
    name: "Solarized",
    note: "Ethan Schoonover's palette, tuned for fixed contrast either way up",
    typography: PLEX_TYPE,
    // Spartan on purpose. Schoonover's palette is a precise instrument and the
    // page around it should not be upholstered.
    components: {
      ...DRAWN,
      heading: { rule: "none", tracking: -0.01, leading: 1.25, minor: "uppercase" },
      quote: "plain",
      rule: "short",
      image: { radius: 4, frame: true },
    },
    light: {
      palette: {
        bg: "#fdf6e3",
        surface: "#eee8d5",
        text: "#586e75",
        muted: "#93a1a1",
        heading: "#073642",
        link: "#268bd2",
        border: "#e5decb",
        codeBg: "#eee8d5",
      },
      shiki: "solarized-light",
    },
    dark: {
      palette: {
        bg: "#002b36",
        surface: "#073642",
        text: "#93a1a1",
        muted: "#657b83",
        heading: "#eee8d5",
        link: "#2aa198",
        border: "#0b4453",
        codeBg: "#073642",
      },
      shiki: "solarized-dark",
    },
  }),

  preset({
    id: "nord",
    name: "Nord",
    note: "Arctic blue-greys. The light half is Nord's own Snow Storm shades",
    typography: NORD_TYPE,
    components: {
      ...PANELLED,
      list: "dash",
      image: { radius: 6, frame: false },
    },
    layout: GRID_TABLES,
    light: {
      palette: {
        bg: "#eceff4",
        surface: "#e5e9f0",
        text: "#3b4252",
        muted: "#4c566a",
        heading: "#2e3440",
        link: "#5e81ac",
        border: "#d8dee9",
        codeBg: "#e5e9f0",
      },
      shiki: "github-light",
    },
    dark: {
      palette: {
        bg: "#2e3440",
        surface: "#3b4252",
        text: "#d8dee9",
        muted: "#9aa5b8",
        heading: "#eceff4",
        link: "#88c0d0",
        border: "#434c5e",
        codeBg: "#3b4252",
      },
      shiki: "nord",
    },
  }),

  preset({
    id: "dracula",
    name: "Dracula",
    note: "The light half is Alucard, Dracula's official daylight counterpart",
    typography: DRACULA_TYPE,
    // Fraunces is drawn to be set without tracking; taking -0.02em out of it, as
    // every theme did until the metrics became the theme's, closed its counters up.
    components: {
      ...PANELLED,
      heading: { rule: "none", tracking: 0, leading: 1.15, minor: "small-caps" },
      quote: "hang",
    },
    light: {
      palette: {
        bg: "#fffbeb",
        surface: "#f6f2e2",
        text: "#1f1f1f",
        muted: "#6c664b",
        heading: "#1f1f1f",
        link: "#036a96",
        border: "#e6e0c8",
        codeBg: "#f6f2e2",
        accent: "#a3144d",
      },
      shiki: "github-light",
    },
    dark: {
      palette: {
        bg: "#282a36",
        surface: "#343746",
        text: "#f8f8f2",
        muted: "#9ea3bd",
        heading: "#f8f8f2",
        link: "#8be9fd",
        border: "#44475a",
        codeBg: "#343746",
        accent: "#ff79c6",
      },
      shiki: "dracula",
    },
  }),

  preset({
    id: "one",
    name: "One",
    note: "Atom's One Light and One Dark",
    typography: ONE_TYPE,
    components: {
      ...PLAIN,
      heading: { rule: "none", tracking: -0.018, leading: 1.22, minor: "uppercase" },
    },
    light: {
      palette: {
        bg: "#fafafa",
        surface: "#f0f0f1",
        text: "#383a42",
        muted: "#8a8b93",
        heading: "#383a42",
        link: "#4078f2",
        border: "#e5e5e6",
        codeBg: "#f0f0f1",
      },
      shiki: "one-light",
    },
    dark: {
      palette: {
        bg: "#282c34",
        surface: "#31353f",
        text: "#abb2bf",
        muted: "#828997",
        heading: "#d7dae0",
        link: "#61afef",
        border: "#3e4451",
        codeBg: "#31353f",
      },
      shiki: "one-dark-pro",
    },
  }),

  preset({
    id: "tokyo-night",
    name: "Tokyo Night",
    note: "Neon on ink. The light half is Tokyo Night Day",
    typography: TOKYO_TYPE,
    components: {
      ...PANELLED,
      heading: { rule: "none", tracking: -0.03, leading: 1.15, minor: "uppercase" },
      code: { block: "card", inline: "bare" },
    },
    light: {
      palette: {
        bg: "#e1e2e7",
        surface: "#d8dae8",
        text: "#343b58",
        muted: "#6c7086",
        heading: "#2e3c64",
        link: "#2e7de9",
        border: "#c4c8da",
        codeBg: "#d8dae8",
      },
      shiki: "github-light",
    },
    dark: {
      palette: {
        bg: "#1a1b26",
        surface: "#24283b",
        text: "#a9b1d6",
        muted: "#7982a9",
        heading: "#c0caf5",
        link: "#7aa2f7",
        border: "#2f344d",
        codeBg: "#24283b",
        accent: "#bb9af7",
      },
      shiki: "tokyo-night",
    },
  }),

  preset({
    id: "catppuccin",
    name: "Catppuccin",
    note: "Latte and Mocha — pastel, low-contrast, easy on the eyes",
    typography: CATPPUCCIN_TYPE,
    components: {
      ...PANELLED,
      heading: { rule: "none", tracking: -0.015, leading: 1.25, minor: "normal" },
      list: "dash",
      tableHead: "sentence",
      image: { radius: 12, frame: false },
    },
    light: {
      palette: {
        bg: "#eff1f5",
        surface: "#e6e9ef",
        text: "#4c4f69",
        muted: "#6c6f85",
        heading: "#4c4f69",
        link: "#1e66f5",
        border: "#dce0e8",
        codeBg: "#e6e9ef",
        accent: "#8839ef",
      },
      shiki: "catppuccin-latte",
    },
    dark: {
      palette: {
        bg: "#1e1e2e",
        surface: "#313244",
        text: "#cdd6f4",
        muted: "#a6adc8",
        heading: "#cdd6f4",
        link: "#89b4fa",
        border: "#45475a",
        codeBg: "#313244",
        accent: "#cba6f7",
      },
      shiki: "catppuccin-mocha",
    },
  }),

  preset({
    id: "gruvbox",
    name: "Gruvbox",
    note: "Retro, warm and heavy — the most paper-like of the editor palettes",
    typography: GRUVBOX_TYPE,
    components: DRAWN,
    light: {
      palette: {
        bg: "#fbf1c7",
        surface: "#f2e5bc",
        text: "#3c3836",
        muted: "#7c6f64",
        heading: "#282828",
        link: "#076678",
        border: "#ebdbb2",
        codeBg: "#f2e5bc",
        accent: "#af3a03",
      },
      shiki: "gruvbox-light-medium",
    },
    dark: {
      palette: {
        bg: "#282828",
        surface: "#32302f",
        text: "#ebdbb2",
        muted: "#a89984",
        heading: "#fbf1c7",
        link: "#83a598",
        border: "#3c3836",
        codeBg: "#32302f",
        accent: "#fe8019",
      },
      shiki: "gruvbox-dark-medium",
    },
  }),

  preset({
    id: "rose-pine",
    name: "Rosé Pine",
    note: "Muted rose and pine. Dawn by day, the original by night",
    typography: ROSE_PINE_TYPE,
    components: LITERARY,
    light: {
      palette: {
        bg: "#faf4ed",
        surface: "#fffaf3",
        text: "#575279",
        muted: "#797593",
        heading: "#575279",
        link: "#286983",
        border: "#dfdad9",
        codeBg: "#f2e9e1",
        accent: "#b4637a",
      },
      shiki: "rose-pine-dawn",
    },
    dark: {
      palette: {
        bg: "#191724",
        surface: "#1f1d2e",
        text: "#e0def4",
        muted: "#908caa",
        heading: "#e0def4",
        link: "#9ccfd8",
        border: "#26233a",
        codeBg: "#1f1d2e",
        accent: "#ebbcba",
      },
      shiki: "rose-pine",
    },
  }),

  preset({
    id: "everforest",
    name: "Everforest",
    note: "Green-based and low saturation, designed to be gentle for long reads",
    typography: EVERFOREST_TYPE,
    // Literary in voice but not in furniture — Rosé Pine already occupies the
    // hanging-quote, asterism, flush-code corner, and two themes that read the
    // same are the problem this whole group exists to fix.
    components: {
      ...PLAIN,
      heading: { rule: "none", tracking: -0.005, leading: 1.2, minor: "small-caps" },
      quote: "card",
      rule: "short",
      code: { block: "framed", inline: "tint" },
      list: "outdent",
      tableHead: "sentence",
    },
    light: {
      palette: {
        bg: "#fdf6e3",
        surface: "#f4f0d9",
        text: "#5c6a72",
        muted: "#829181",
        heading: "#4f585e",
        link: "#3a94c5",
        border: "#edeada",
        codeBg: "#f4f0d9",
        accent: "#8da101",
      },
      shiki: "everforest-light",
    },
    dark: {
      palette: {
        bg: "#2d353b",
        surface: "#343f44",
        text: "#d3c6aa",
        muted: "#9da9a0",
        heading: "#d3c6aa",
        link: "#7fbbb3",
        border: "#3d484d",
        codeBg: "#343f44",
        accent: "#a7c080",
      },
      shiki: "everforest-dark",
    },
  }),

  preset({
    id: "paper",
    name: "Paper",
    note: "Sepia and lamplight, set in Garamond — for reading, not scanning",
    typography: PAPER_TYPE,
    components: {
      ...LITERARY,
      heading: { rule: "none", tracking: 0, leading: 1.2, minor: "small-caps" },
      list: "outdent",
      image: { radius: 0, frame: true },
    },
    // Wider gutters: a justified measure needs air either side or the block reads
    // as a slab pushed against the window.
    layout: { ...LAYOUT, pagePadding: 3 },
    light: {
      palette: {
        bg: "#f4ecd8",
        surface: "#ece2c8",
        text: "#433422",
        muted: "#6b5c48",
        heading: "#2f2517",
        link: "#8a5a2b",
        border: "#ded0b0",
        codeBg: "#ece2c8",
      },
      shiki: "vitesse-light",
    },
    dark: {
      palette: {
        bg: "#14120f",
        surface: "#1c1916",
        text: "#cbbfa8",
        muted: "#92876f",
        heading: "#e0d5bd",
        link: "#c08a4e",
        border: "#2b261f",
        codeBg: "#1c1916",
      },
      shiki: "vitesse-dark",
    },
  }),

  preset({
    id: "contrast",
    name: "High Contrast",
    note: "Maximum contrast in Atkinson Hyperlegible, at a short measure",
    typography: LEGIBLE_TYPE,
    // Structure made visible, not just legible: the heading rules say where a
    // section starts without asking the reader to compare two type sizes.
    components: {
      ...DRAWN,
      heading: { rule: "h1-h2", tracking: 0, leading: 1.25, minor: "uppercase" },
      alert: "card",
      image: { radius: 0, frame: true },
    },
    layout: GRID_TABLES,
    light: {
      palette: {
        bg: "#ffffff",
        surface: "#f0f0f0",
        text: "#000000",
        muted: "#3d3d3d",
        heading: "#000000",
        link: "#0349b4",
        border: "#4a4a4a",
        codeBg: "#f0f0f0",
      },
      shiki: "github-light-high-contrast",
    },
    dark: {
      palette: {
        bg: "#000000",
        surface: "#0d0d0d",
        text: "#ffffff",
        muted: "#c9c9c9",
        heading: "#ffffff",
        link: "#71b7ff",
        border: "#b0b0b0",
        codeBg: "#0d0d0d",
      },
      shiki: "github-dark-high-contrast",
    },
  }),

  preset({
    id: "colorblind",
    name: "Colorblind Safe",
    note: "Hues that stay apart under every common colour blindness, code included",
    typography: CVD_TYPE,
    // Redundant encoding, which is this theme's entire argument extended past
    // hue: gridded and striped rows so a table is trackable without colour, an
    // outlined code block so it has an edge and not just a tint, and a rule under
    // h2 so hierarchy survives a palette anyone cannot fully see.
    components: {
      ...DRAWN,
      heading: { rule: "h2", tracking: -0.01, leading: 1.22, minor: "uppercase" },
      alert: "card",
      image: { radius: 0, frame: true },
    },
    layout: {
      ...LAYOUT,
      table: { density: "comfortable", rules: "grid", zebra: true },
    },
    light: {
      palette: {
        bg: "#fbfbfa",
        surface: "#f0f0ef",
        text: "#1a1a1a",
        muted: "#4d4d4d",
        heading: "#000000",
        link: "#0072b2", // blue: the one hue no common deficiency loses
        border: "#c4c4c2",
        codeBg: "#f2f2f2",
        accent: "#d55e00", // vermillion, which reads as "not the link" to everyone
      },
      shiki: "lindo-md-cvd-light",
      alerts: CVD_ALERTS.light,
    },
    dark: {
      palette: {
        bg: "#161616",
        surface: "#202020",
        text: "#eaeaea",
        muted: "#b0b0b0",
        heading: "#ffffff",
        link: "#56b4e9",
        border: "#3d3d3d",
        codeBg: "#1e1e1e",
        accent: "#e69f00",
      },
      shiki: "lindo-md-cvd-dark",
      alerts: CVD_ALERTS.dark,
    },
  }),
  preset({
    id: "ayu",
    name: "Ayu",
    note: "Modern and low-noise, with Ayu's signature amber accent",
    typography: AYU_TYPE,
    components: {
      ...PANELLED,
      image: { radius: 8, frame: false },
    },
    light: {
      palette: {
        bg: "#fcfcfc",
        surface: "#f3f4f5",
        text: "#5c6166",
        muted: "#8a9199",
        heading: "#3b4045",
        link: "#399ee6",
        border: "#e7e8e9",
        codeBg: "#f3f4f5",
        accent: "#f2ae49",
      },
      shiki: "min-light",
    },
    dark: {
      palette: {
        bg: "#0b0e14",
        surface: "#0f131a",
        text: "#bfbdb6",
        muted: "#8a9199",
        heading: "#d9d7ce",
        link: "#59c2ff",
        border: "#1d2228",
        codeBg: "#0f131a",
        accent: "#e6b450",
      },
      shiki: "ayu-dark",
    },
  }),

  preset({
    id: "kanagawa",
    name: "Kanagawa",
    note: "Ink and pigment after Hokusai — Lotus by day, Wave by night",
    typography: KANAGAWA_TYPE,
    // A woodblock print has no boxes in it. Quiet furniture throughout, but not
    // Rosé Pine's: quotations sit plain, breaks are short rules, code is framed.
    components: {
      ...PLAIN,
      heading: { rule: "none", tracking: -0.008, leading: 1.22, minor: "small-caps" },
      quote: "plain",
      rule: "short",
      code: { block: "framed", inline: "bare" },
      alert: "minimal",
      list: "outdent",
      tableHead: "sentence",
      image: { radius: 2, frame: true },
    },
    light: {
      // Lotus: a warm paper ground, which is unusual enough among light themes to
      // be the reason to have it beside Paper's sepia.
      palette: {
        bg: "#f2ecbc",
        surface: "#e7dba0",
        text: "#545464",
        muted: "#716e61",
        heading: "#43436c",
        link: "#4d699b",
        border: "#e5ddb0",
        codeBg: "#e7dba0",
        accent: "#77713f",
      },
      shiki: "kanagawa-lotus",
    },
    dark: {
      palette: {
        bg: "#1f1f28",
        surface: "#2a2a37",
        text: "#dcd7ba",
        muted: "#727169",
        heading: "#c8c093",
        link: "#7fb4ca",
        border: "#363646",
        codeBg: "#2a2a37",
        accent: "#e6c384",
      },
      shiki: "kanagawa-wave",
    },
  }),

  preset({
    id: "vitesse",
    name: "Vitesse",
    note: "Muted and reading-first, in an old-style face set large",
    typography: VITESSE_TYPE,
    components: {
      ...PLAIN,
      // The rule under h2 is the only line on the page, which is what lets
      // everything else stay unmarked.
      heading: { rule: "h2", tracking: -0.01, leading: 1.2, minor: "small-caps" },
      quote: "plain",
      rule: "short",
      code: { block: "flush", inline: "bare" },
      alert: "minimal",
      list: "dash",
      tableHead: "sentence",
      image: { radius: 4, frame: false },
    },
    light: {
      palette: {
        bg: "#ffffff",
        surface: "#f7f7f6",
        text: "#393a34",
        muted: "#7c7c74",
        heading: "#25261f",
        link: "#1e754f",
        border: "#e5e5e0",
        codeBg: "#f7f7f6",
        accent: "#b56959",
      },
      shiki: "vitesse-light",
    },
    dark: {
      palette: {
        bg: "#121212",
        surface: "#1a1a1a",
        text: "#dbd7ca",
        muted: "#8b8b82",
        heading: "#eeeeec",
        link: "#4d9375",
        border: "#252525",
        codeBg: "#1a1a1a",
        accent: "#c98a7d",
      },
      shiki: "vitesse-dark",
    },
  }),

  preset({
    id: "material",
    name: "Material",
    note: "Google's palette as an editor knows it — teal on slate",
    typography: MATERIAL_TYPE,
    components: {
      ...PANELLED,
      heading: { rule: "none", tracking: -0.01, leading: 1.2, minor: "uppercase" },
      image: { radius: 10, frame: false },
    },
    // Material's data tables are striped, and it is the one convention the design
    // language is most literally known for.
    layout: {
      ...LAYOUT,
      table: { density: "comfortable", rules: "hairline", zebra: true },
    },
    light: {
      // Material Lighter's own foreground is #90A4AE, which is a placeholder grey
      // and lands near 2:1 against its ground. Body text here is the palette's
      // #37474F instead — the theme's own darker slate, at a contrast a page of
      // prose can actually be read at.
      palette: {
        bg: "#fafafa",
        surface: "#ffffff",
        text: "#37474f",
        muted: "#7e939e",
        heading: "#263238",
        link: "#6182b8",
        border: "#e7eaec",
        codeBg: "#ffffff",
        accent: "#39adb5",
      },
      shiki: "material-theme-lighter",
    },
    dark: {
      palette: {
        bg: "#263238",
        surface: "#2e3c43",
        text: "#eeffff",
        muted: "#8d9ba3",
        heading: "#ffffff",
        link: "#82aaff",
        border: "#37474f",
        codeBg: "#2e3c43",
        accent: "#80cbc4",
      },
      shiki: "material-theme",
    },
  }),

  preset({
    id: "night-owl",
    name: "Night Owl",
    note: "Sarah Drasner's, for reading at one in the morning",
    typography: NIGHT_OWL_TYPE,
    components: {
      ...PLAIN,
      heading: { rule: "none", tracking: -0.015, leading: 1.2, minor: "uppercase" },
      rule: "short",
      tableHead: "sentence",
      image: { radius: 8, frame: false },
    },
    light: {
      palette: {
        bg: "#fbfbfb",
        surface: "#f0f0f0",
        text: "#403f53",
        muted: "#7a8181",
        heading: "#0c969b",
        link: "#4876d6",
        border: "#e0e0e0",
        codeBg: "#f0f0f0",
        accent: "#994cc3",
      },
      shiki: "light-plus",
    },
    dark: {
      palette: {
        bg: "#011627",
        surface: "#0b2942",
        text: "#d6deeb",
        muted: "#7f9cb3",
        heading: "#c5e478",
        link: "#82aaff",
        border: "#1d3b53",
        codeBg: "#0b2942",
        accent: "#c792ea",
      },
      shiki: "night-owl",
    },
  }),
];

export const DEFAULT_PRESET_ID = "house";

export function findPreset(id: string): ThemePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * Resolves the settings — a preset id, an appearance, and any custom themes —
 * into the one theme to apply. Falls back to House rather than throwing: a
 * config naming a theme that no longer exists should not leave a blank window.
 */
export function resolveTheme(
  themeId: string,
  appearance: Appearance,
  customThemes: Theme[] = [],
): Theme {
  const custom = customThemes.find((t) => t.id === themeId);
  if (custom) return custom;

  const preset = findPreset(themeId) ?? findPreset(DEFAULT_PRESET_ID)!;
  return preset[appearance];
}
