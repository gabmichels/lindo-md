import { describe, expect, it } from "vitest";

import { adoptDiagramStyles, pruneDiagramStyles, stripRemoteRefs } from "./mermaid";

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

/**
 * Mermaid puts every fill, stroke and `text-align` in a `<style>` inside the
 * SVG, and in the packaged app that element is inert: Tauri appends a nonce to
 * `style-src`, and a nonce makes CSP ignore the `'unsafe-inline'` beside it. The
 * diagram then draws in SVG's own defaults — black boxes, no borders, labels
 * shoved left — with no error anywhere. It shipped in 1.7.0 because `vite dev`
 * serves no CSP at all, so every development run looks right.
 *
 * jsdom has constructed stylesheets but no `adoptedStyleSheets`, so the document
 * side is stubbed. What is being tested is the bookkeeping — one sheet per
 * diagram, refreshed on re-render, dropped when the diagram goes — which is the
 * part that leaks or goes stale if it is wrong.
 */
describe("adoptDiagramStyles", () => {
  function withAdoption(run: () => void): void {
    const had = Object.getOwnPropertyDescriptor(Document.prototype, "adoptedStyleSheets");
    let sheets: CSSStyleSheet[] = [];
    Object.defineProperty(Document.prototype, "adoptedStyleSheets", {
      configurable: true,
      get: () => sheets,
      set: (next: CSSStyleSheet[]) => (sheets = next),
    });
    try {
      run();
    } finally {
      // Emptied and pruned while the stub is still installed: the module holds
      // its sheets in a map that outlives the test, and pruning after the
      // property is gone is a read of `undefined`.
      document.body.innerHTML = "";
      pruneDiagramStyles();
      if (had) Object.defineProperty(Document.prototype, "adoptedStyleSheets", had);
      else delete (Document.prototype as unknown as Record<string, unknown>).adoptedStyleSheets;
    }
  }

  function diagram(id: string, css: string): HTMLElement {
    const figure = document.createElement("figure");
    figure.className = "mermaid";
    figure.innerHTML = `<svg id="${id}"><style>${css}</style><rect></rect></svg>`;
    document.body.append(figure);
    return figure;
  }

  it("adopts the diagram's own stylesheet", () => {
    withAdoption(() => {
      adoptDiagramStyles(diagram("mermaid-1", "#mermaid-1 .node rect{fill:#161a1e}"));

      expect(document.adoptedStyleSheets).toHaveLength(1);
      expect(document.adoptedStyleSheets[0]?.cssRules[0]?.cssText).toContain("#mermaid-1");
    });
  });

  it("leaves the inert <style> in place, because an export has no CSP", () => {
    withAdoption(() => {
      const figure = diagram("mermaid-2", "#mermaid-2 rect{fill:#fff}");
      adoptDiagramStyles(figure);

      // `export/html.ts` serializes the canvas; the element is how a diagram
      // keeps its colours in a file opened outside the app.
      expect(figure.querySelector("style")?.textContent).toContain("#mermaid-2");
    });
  });

  it("refreshes rather than stacks when the same diagram re-renders", () => {
    withAdoption(() => {
      const figure = diagram("mermaid-3", "#mermaid-3 rect{fill:#000000}");
      adoptDiagramStyles(figure);

      // What a theme change does: same id, a palette baked in afresh.
      figure.querySelector("style")!.textContent = "#mermaid-3 rect{fill:#ffffff}";
      adoptDiagramStyles(figure);

      expect(document.adoptedStyleSheets).toHaveLength(1);
      expect(document.adoptedStyleSheets[0]?.cssRules[0]?.cssText).toContain("#ffffff");
    });
  });

  it("drops the sheet once its diagram has left the document", () => {
    withAdoption(() => {
      const gone = diagram("mermaid-4", "#mermaid-4 rect{fill:#111}");
      adoptDiagramStyles(gone);
      adoptDiagramStyles(diagram("mermaid-5", "#mermaid-5 rect{fill:#222}"));
      expect(document.adoptedStyleSheets).toHaveLength(2);

      // `mirror` replaces the blocks an edit touched; the figure simply vanishes.
      gone.remove();
      pruneDiagramStyles();

      expect(document.adoptedStyleSheets).toHaveLength(1);
      expect(document.adoptedStyleSheets[0]?.cssRules[0]?.cssText).toContain("#222");
    });
  });

  it("does nothing for a figure that failed to render", () => {
    withAdoption(() => {
      const failed = document.createElement("figure");
      failed.className = "mermaid mermaid-error";
      failed.innerHTML = `<figcaption>Diagram could not be rendered</figcaption>`;
      document.body.append(failed);

      adoptDiagramStyles(failed);

      expect(document.adoptedStyleSheets).toHaveLength(0);
    });
  });
});
