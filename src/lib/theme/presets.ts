import type { Appearance, Theme, ThemeColors, ThemePreset, ThemeTypography } from "./schema";

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
 * A preset only chooses colors and a code theme. Typography is a separate, small
 * set of pairings (below), because "which font at which size" is a different
 * decision from "which palette", and most users adjust it independently.
 */

// --- typography pairings ----------------------------------------------------

/** The House voice: serif body, sans headings. Editorial, and deliberately not
 *  Medium's — the pairing, the 1.22 scale and the 66ch measure are ours. */
const EDITORIAL: ThemeTypography = {
  bodyFont: '"Source Serif 4 Variable", Georgia, serif',
  headingFont: '"Inter Tight Variable", system-ui, sans-serif',
  monoFont: '"JetBrains Mono Variable", ui-monospace, monospace',
  baseSize: 19.5,
  scale: 1.22,
  lineHeight: 1.62,
  measure: 66,
  paragraphSpacing: 1.15,
  letterSpacing: 0,
  headingWeight: 600,
  justify: false,
};

/** For the themes people know from a screen full of UI rather than a page of
 *  prose. Sans throughout, tighter leading, wider measure. */
const INTERFACE: ThemeTypography = {
  ...EDITORIAL,
  bodyFont: '"Inter Variable", system-ui, sans-serif',
  headingFont: '"Inter Tight Variable", system-ui, sans-serif',
  baseSize: 17,
  lineHeight: 1.55,
  measure: 76,
  letterSpacing: -0.005,
};

/** Long-form reading: an old-style face, larger, looser, narrower. */
const BOOK: ThemeTypography = {
  ...EDITORIAL,
  bodyFont: '"EB Garamond Variable", Georgia, serif',
  headingFont: '"EB Garamond Variable", Georgia, serif',
  baseSize: 22,
  lineHeight: 1.7,
  measure: 62,
  headingWeight: 600,
};

/** Atkinson Hyperlegible was drawn by the Braille Institute to keep similar
 *  letterforms distinguishable. Paired here with a large size and a short
 *  measure — the high-contrast palette is only half of legibility. */
const LEGIBLE: ThemeTypography = {
  ...EDITORIAL,
  bodyFont: '"Atkinson Hyperlegible", system-ui, sans-serif',
  headingFont: '"Atkinson Hyperlegible", system-ui, sans-serif',
  monoFont: '"IBM Plex Mono", ui-monospace, monospace',
  baseSize: 20,
  lineHeight: 1.7,
  measure: 60,
  headingWeight: 700,
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

function colorsFrom(palette: Palette, appearance: Appearance): ThemeColors {
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
    alert: { ...ALERTS[appearance] },
  };
}

function theme(
  id: string,
  name: string,
  appearance: Appearance,
  palette: Palette,
  shikiTheme: string,
  typography: ThemeTypography = EDITORIAL,
): Theme {
  return {
    id,
    name,
    appearance,
    colors: colorsFrom(palette, appearance),
    typography,
    code: { shikiTheme, lineNumbers: false },
  };
}

interface PresetSpec {
  id: string;
  name: string;
  note: string;
  typography?: ThemeTypography;
  light: { palette: Palette; shiki: string };
  dark: { palette: Palette; shiki: string };
}

function preset(spec: PresetSpec): ThemePreset {
  const typography = spec.typography ?? EDITORIAL;
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
    ),
    dark: theme(
      `${spec.id}-dark`,
      `${spec.name} Dark`,
      "dark",
      spec.dark.palette,
      spec.dark.shiki,
      typography,
    ),
  };
}

// --- the presets ------------------------------------------------------------

export const PRESETS: ThemePreset[] = [
  preset({
    id: "house",
    name: "House",
    note: "lindo-md's own — warm bone paper, serif body, ink-teal links",
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
    typography: INTERFACE,
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
    typography: INTERFACE,
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
    typography: BOOK,
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
    typography: LEGIBLE,
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
