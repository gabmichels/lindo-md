import { describe, expect, it } from "vitest";

import { stripRemoteRefs } from "./mermaid";

/**
 * Mermaid renders a ```mermaid fence into SVG inside the webview, so its output
 * never passes through ammonia — `markdown.rs` hands the fence body over
 * HTML-escaped and the markup only becomes markup later. With `htmlLabels` on,
 * a label is free to carry an `<img>`.
 *
 * A CDP session against the running app confirmed the request leaving before
 * this existed, twice per render. These cases are that document, minus the app.
 */

function svg(inner: string): HTMLElement {
  const figure = document.createElement("figure");
  // Assigned while detached, exactly as `renderDiagram` does — nothing in a
  // detached tree fetches, which is what makes stripping here reliable.
  figure.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  return figure;
}

describe("stripRemoteRefs", () => {
  it("removes the src of a remote image in an html label", () => {
    const figure = svg(
      `<foreignObject><img src="https://probe.invalid/beacon.png?id=1"></foreignObject>`,
    );
    stripRemoteRefs(figure);
    expect(figure.querySelector("img")?.getAttribute("src")).toBeNull();
  });

  it("removes protocol-relative and http sources too", () => {
    const figure = svg(`<img src="//probe.invalid/a.png"><img src="http://probe.invalid/b.png">`);
    stripRemoteRefs(figure);
    for (const img of figure.querySelectorAll("img")) {
      expect(img.getAttribute("src")).toBeNull();
    }
  });

  it("covers SVG <image> and <use>, in both href spellings", () => {
    const figure = svg(
      `<image href="https://probe.invalid/a.png"></image>` +
        `<image xlink:href="https://probe.invalid/b.png"></image>` +
        `<use href="https://probe.invalid/c.svg#i"></use>`,
    );
    stripRemoteRefs(figure);
    expect(figure.innerHTML).not.toContain("probe.invalid");
  });

  it("neutralises url() in a style attribute and in an injected <style>", () => {
    const figure = svg(
      `<style>.n{background:url('https://probe.invalid/x.png')}</style>` +
        `<rect style="fill:url(https://probe.invalid/y.png)"></rect>`,
    );
    stripRemoteRefs(figure);
    expect(figure.innerHTML).not.toContain("probe.invalid");
  });

  it("neutralises every url() in one stylesheet, not just the first", () => {
    // Regression: `REMOTE_URL` is global, so an early `.test()` would leave
    // `lastIndex` mid-string and the following `.replace()` would skip a match.
    const figure = svg(
      `<style>.a{background:url(https://probe.invalid/1.png)}` +
        `.b{background:url(https://probe.invalid/2.png)}</style>`,
    );
    stripRemoteRefs(figure);
    expect(figure.innerHTML).not.toContain("probe.invalid");
  });

  it("leaves local and data references alone", () => {
    const figure = svg(
      `<img src="data:image/png;base64,AAAA"><use href="#arrowhead"></use>` +
        `<rect style="fill:url(#gradient)"></rect>`,
    );
    stripRemoteRefs(figure);
    expect(figure.querySelector("img")?.getAttribute("src")).toContain("data:image/png");
    expect(figure.querySelector("use")?.getAttribute("href")).toBe("#arrowhead");
    expect(figure.querySelector("rect")?.getAttribute("style")).toBe("fill:url(#gradient)");
  });
});
