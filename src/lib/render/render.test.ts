import { beforeEach, describe, expect, it, vi } from "vitest";

import { _stripDelimiters } from "./katex";
import { markExternalLinks } from "./links";
import { hasBlockedImages, loadBlockedImages, resolveImages } from "./images";

// `convertFileSrc` needs a Tauri host. The identity-ish stub keeps the resolved
// path visible in assertions, which is the part these tests are about.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function root(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

describe("stripDelimiters", () => {
  it("removes the delimiters comrak leaves on math spans", () => {
    expect(_stripDelimiters("$a^2$")).toBe("a^2");
    expect(_stripDelimiters("$$\\sum x$$")).toBe("\\sum x");
    expect(_stripDelimiters("  $a$  ")).toBe("a");
  });

  it("leaves a formula that has no delimiters alone", () => {
    expect(_stripDelimiters("a^2")).toBe("a^2");
  });

  it("does not eat a lone dollar sign", () => {
    // "$" is not a delimited formula, and slicing it would produce "".
    expect(_stripDelimiters("$")).toBe("$");
  });
});

describe("markExternalLinks", () => {
  it("distinguishes external, anchor and internal links", () => {
    const element = root(`
      <a href="https://example.com">out</a>
      <a href="#section">anchor</a>
      <a href="./guide.md">internal</a>
    `);
    markExternalLinks(element);

    expect(
      element.querySelector<HTMLElement>('a[href^="https"]')?.dataset.external,
    ).toBe("true");
    expect(
      element.querySelector<HTMLElement>('a[href^="#"]')?.dataset.anchor,
    ).toBe("true");

    const internal = element.querySelector('a[href$="guide.md"]') as HTMLElement;
    expect(internal.dataset.external).toBeUndefined();
    expect(internal.dataset.anchor).toBeUndefined();
  });
});

describe("resolveImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a relative source against the document's directory", () => {
    const element = root(`<img src="img/a.png" alt="a">`);
    resolveImages(element, { dir: "/docs", blockRemote: true });

    const img = element.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("asset:///docs/img/a.png");
    expect(img.dataset.originalSrc).toBe("img/a.png");
  });

  it("blocks a remote image by making no request at all", () => {
    const element = root(`<img src="https://tracker.test/pixel.gif">`);
    resolveImages(element, { dir: "/docs", blockRemote: true });

    const img = element.querySelector("img")!;
    // Clearing the attribute is the point: hiding the element would still fetch.
    expect(img.hasAttribute("src")).toBe(false);
    expect(img.dataset.blocked).toBe("true");
    expect(hasBlockedImages(element)).toBe(true);
  });

  it("loads a remote image when blocking is off", () => {
    const element = root(`<img src="https://example.com/a.png">`);
    resolveImages(element, { dir: "/docs", blockRemote: false });

    expect(element.querySelector("img")!.getAttribute("src")).toBe(
      "https://example.com/a.png",
    );
    expect(hasBlockedImages(element)).toBe(false);
  });

  it("restores blocked images on request, from the remembered original", () => {
    const element = root(`<img src="https://example.com/a.png">`);
    resolveImages(element, { dir: "/docs", blockRemote: true });
    loadBlockedImages(element);

    const img = element.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://example.com/a.png");
    expect(img.dataset.blocked).toBeUndefined();
    expect(hasBlockedImages(element)).toBe(false);
  });

  it("leaves inline data URIs untouched", () => {
    const uri = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    const element = root(`<img src="${uri}">`);
    resolveImages(element, { dir: "/docs", blockRemote: true });
    expect(element.querySelector("img")!.getAttribute("src")).toBe(uri);
  });

  it("is idempotent, so re-enhancing does not double-resolve a path", () => {
    const element = root(`<img src="img/a.png">`);
    resolveImages(element, { dir: "/docs", blockRemote: true });
    resolveImages(element, { dir: "/docs", blockRemote: true });
    expect(element.querySelector("img")!.getAttribute("src")).toBe(
      "asset:///docs/img/a.png",
    );
  });
});
