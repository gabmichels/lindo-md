#!/usr/bin/env node
/**
 * Generates `src/fonts.css` from the installed Fontsource packages.
 *
 * Why generate rather than `@import "@fontsource-variable/inter"`, which is what
 * this repo did until now:
 *
 *  1. **Subsets.** A package's `index.css` declares every subset Google ships —
 *     Cyrillic, Greek, Vietnamese. `unicode-range` means a browser never *fetches*
 *     them, but Vite still bundles every referenced `.woff2` into the installer, so
 *     we were shipping alphabets the app cannot even be localised into. Only `latin`
 *     and `latin-ext` survive here.
 *
 *  2. **Italics.** `index.css` is upright only. Every `<em>` and every blockquote
 *     — `document.css` sets `font-style: italic` on all of them — was being
 *     synthesised by the renderer as a mechanical slant. A drawn italic is a
 *     different set of letterforms, not the roman leaning over, and in a serif face
 *     the difference is the single most visible thing on the page.
 *
 *  3. **Optical sizing.** The `opsz` axis lives in the package's `opsz.css`;
 *     `index.css` carries `wght` alone. Importing the root meant `font-optical-sizing`
 *     had nothing to act on. Where a family has the axis we take it, and the browser
 *     applies it automatically — `auto` is the initial value, so no CSS asks for it.
 *
 * Run `pnpm fonts` after changing FAMILIES. The output is committed, so a normal
 * build and a fresh clone never need this script.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(root, "node_modules");

/** The subsets the app ships. Everything else is dropped. */
const SUBSETS = ["latin", "latin-ext"];

/**
 * The bundled families, in picker order within each role.
 *
 * `axis` names the variable stylesheet to take: `opsz` where the family has an
 * optical-size axis, `full` for Fraunces (whose SOFT and WONK axes are what make
 * it worth bundling at all), `wght` otherwise. `weights` marks a family Google
 * never made variable, which is imported as discrete faces instead.
 *
 * `role` drives the grouping in the font picker and is exported alongside the CSS
 * so the two cannot drift — a family added here shows up there without a second
 * edit.
 */
const FAMILIES = [
  // --- serif ---------------------------------------------------------------
  {
    pkg: "source-serif-4",
    family: "Source Serif 4 Variable",
    label: "Source Serif 4",
    role: "serif",
    axis: "opsz",
  },
  { pkg: "literata", family: "Literata Variable", label: "Literata", role: "serif", axis: "opsz" },
  {
    pkg: "newsreader",
    family: "Newsreader Variable",
    label: "Newsreader",
    role: "serif",
    axis: "opsz",
  },
  {
    pkg: "eb-garamond",
    family: "EB Garamond Variable",
    label: "EB Garamond",
    role: "serif",
    axis: "wght",
  },
  {
    pkg: "crimson-pro",
    family: "Crimson Pro Variable",
    label: "Crimson Pro",
    role: "serif",
    axis: "wght",
  },
  { pkg: "lora", family: "Lora Variable", label: "Lora", role: "serif", axis: "wght" },
  { pkg: "faustina", family: "Faustina Variable", label: "Faustina", role: "serif", axis: "wght" },
  { pkg: "alegreya", family: "Alegreya Variable", label: "Alegreya", role: "serif", axis: "wght" },
  { pkg: "bitter", family: "Bitter Variable", label: "Bitter", role: "serif", axis: "wght" },
  { pkg: "fraunces", family: "Fraunces Variable", label: "Fraunces", role: "serif", axis: "full" },
  {
    pkg: "ibm-plex-serif",
    family: "IBM Plex Serif",
    label: "IBM Plex Serif",
    role: "serif",
    weights: [400, 600],
  },

  // --- sans ----------------------------------------------------------------
  { pkg: "inter", family: "Inter Variable", label: "Inter", role: "sans", axis: "opsz" },
  {
    pkg: "inter-tight",
    family: "Inter Tight Variable",
    label: "Inter Tight",
    role: "sans",
    axis: "wght",
  },
  { pkg: "geist", family: "Geist Variable", label: "Geist", role: "sans", axis: "wght" },
  {
    pkg: "public-sans",
    family: "Public Sans Variable",
    label: "Public Sans",
    role: "sans",
    axis: "wght",
  },
  {
    pkg: "schibsted-grotesk",
    family: "Schibsted Grotesk Variable",
    label: "Schibsted Grotesk",
    role: "sans",
    axis: "wght",
  },
  { pkg: "figtree", family: "Figtree Variable", label: "Figtree", role: "sans", axis: "wght" },
  {
    pkg: "space-grotesk",
    family: "Space Grotesk Variable",
    label: "Space Grotesk",
    role: "sans",
    axis: "wght",
  },
  {
    pkg: "source-sans-3",
    family: "Source Sans 3 Variable",
    label: "Source Sans 3",
    role: "sans",
    axis: "wght",
  },
  {
    pkg: "ibm-plex-sans",
    family: "IBM Plex Sans",
    label: "IBM Plex Sans",
    role: "sans",
    weights: [400, 600],
  },
  {
    pkg: "atkinson-hyperlegible-next",
    family: "Atkinson Hyperlegible Next Variable",
    label: "Atkinson Hyperlegible",
    role: "sans",
    axis: "wght",
  },

  // --- mono ----------------------------------------------------------------
  {
    pkg: "jetbrains-mono",
    family: "JetBrains Mono Variable",
    label: "JetBrains Mono",
    role: "mono",
    axis: "wght",
  },
  {
    pkg: "geist-mono",
    family: "Geist Mono Variable",
    label: "Geist Mono",
    role: "mono",
    axis: "wght",
  },
  {
    pkg: "fira-code",
    family: "Fira Code Variable",
    label: "Fira Code",
    role: "mono",
    axis: "wght",
  },
  {
    pkg: "source-code-pro",
    family: "Source Code Pro Variable",
    label: "Source Code Pro",
    role: "mono",
    axis: "wght",
  },
  {
    pkg: "ibm-plex-mono",
    family: "IBM Plex Mono",
    label: "IBM Plex Mono",
    role: "mono",
    weights: [400, 600],
  },

  /**
   * Not in the picker. v1.5.1 and earlier offered the original static Atkinson
   * Hyperlegible, and a theme file or config written then names it verbatim. The
   * Braille Institute's own successor is a strict improvement and is what the
   * picker now offers, but dropping the old family outright would silently demote
   * a saved accessibility choice to `system-ui` — which is the exact reader this
   * face exists for. Kept as two faces, ~60KB, until a config migration retires it.
   */
  {
    pkg: "atkinson-hyperlegible",
    family: "Atkinson Hyperlegible",
    label: "Atkinson Hyperlegible (legacy)",
    role: "compat",
    weights: [400, 700],
  },
];

/** Splits a Fontsource stylesheet into `@font-face` blocks with their comment. */
function faces(css) {
  return [...css.matchAll(/\/\*[^*]*\*\/\s*@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
}

/** Fontsource names every file `<pkg>-<subset>-<...>.woff2`, which is the only
 *  place the subset is stated — the `unicode-range` would have to be matched
 *  against a table to recover it. */
function subsetOf(block) {
  const url = /url\(\.\/files\/([^)]+)\)/.exec(block);
  if (!url) return null;
  for (const subset of SUBSETS) {
    if (url[1].includes(`-${subset}-`)) return subset;
  }
  return null;
}

function stylesheets(entry) {
  if (entry.weights) {
    return entry.weights.flatMap((weight) =>
      SUBSETS.flatMap((subset) => [`${subset}-${weight}.css`, `${subset}-${weight}-italic.css`]),
    );
  }
  return [`${entry.axis}.css`, `${entry.axis}-italic.css`];
}

function collect(entry) {
  const scope = entry.weights ? "@fontsource" : "@fontsource-variable";
  const dir = join(modules, scope, entry.pkg);
  if (!existsSync(dir)) throw new Error(`${scope}/${entry.pkg} is not installed`);

  const blocks = [];
  for (const sheet of stylesheets(entry)) {
    const path = join(dir, sheet);
    // Fira Code and Space Grotesk have no italic; a missing stylesheet is the
    // family saying so, not a mistake.
    if (!existsSync(path)) continue;
    for (const block of faces(readFileSync(path, "utf8"))) {
      // Per-subset stylesheets are already narrow; the axis ones are not.
      if (!subsetOf(block)) continue;
      blocks.push(
        block.replace(/url\(\.\/files\//g, `url(../node_modules/${scope}/${entry.pkg}/files/`),
      );
    }
  }
  if (blocks.length === 0)
    throw new Error(`${entry.pkg} produced no faces — check the axis or weights`);
  return blocks;
}

const sections = FAMILIES.map((entry) => {
  const blocks = collect(entry);
  const source = entry.weights ? `weights ${entry.weights.join(", ")}` : `${entry.axis} axis`;
  return `/* ${entry.label} — ${source}, ${blocks.length} faces */\n${blocks.join("\n\n")}`;
});

const header = `/* ===========================================================================
   GENERATED by scripts/fonts.mjs — do not edit. Run \`pnpm fonts\` instead.

   ${FAMILIES.filter((f) => f.role !== "compat").length} bundled families, latin and latin-ext only, upright and italic,
   taking each family's optical-size axis where it has one.
   The picker's list is generated from the same manifest: src/lib/theme/fonts.ts.
   =========================================================================== */\n`;

writeFileSync(join(root, "src", "fonts.css"), `${header}\n${sections.join("\n\n")}\n`);

/**
 * The picker's list, from the same manifest — a family cannot be bundled without
 * being offered, or offered without being bundled.
 */
const FALLBACK = {
  serif: "Georgia, serif",
  sans: "system-ui, sans-serif",
  mono: "ui-monospace, monospace",
};

const entries = FAMILIES.filter((f) => f.role !== "compat").map(
  (f) =>
    `  { label: ${JSON.stringify(f.label)}, role: ${JSON.stringify(f.role)}, ` +
    `value: ${JSON.stringify(`"${f.family}", ${FALLBACK[f.role]}`)} },`,
);

writeFileSync(
  join(root, "src", "lib", "theme", "fonts.ts"),
  `// GENERATED by scripts/fonts.mjs — do not edit. Run \`pnpm fonts\` instead.

/** A bundled family, as the font pickers offer it. \`value\` is the CSS
 *  font-family list a theme stores. */
export interface BundledFont {
  label: string;
  role: "serif" | "sans" | "mono";
  value: string;
}

export const BUNDLED_FONTS: BundledFont[] = [
${entries.join("\n")}
];
`,
);

const total = sections.reduce((n, s) => n + (s.match(/@font-face/g) ?? []).length, 0);
console.log(`src/fonts.css — ${FAMILIES.length} families, ${total} faces`);
