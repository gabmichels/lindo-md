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
