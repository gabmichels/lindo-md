import { beforeEach, describe, expect, it, vi } from "vitest";

import { _stripDelimiters } from "./katex";
import { linkTarget, markExternalLinks } from "./links";
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

    expect(element.querySelector<HTMLElement>('a[href^="https"]')?.dataset.external).toBe("true");
    expect(element.querySelector<HTMLElement>('a[href^="#"]')?.dataset.anchor).toBe("true");

    const internal = element.querySelector<HTMLElement>('a[href$="guide.md"]')!;
    expect(internal.dataset.external).toBeUndefined();
    expect(internal.dataset.anchor).toBeUndefined();
  });
});

describe("linkTarget", () => {
  it("sends a link with a scheme out to the OS", () => {
    expect(linkTarget("/docs", "https://example.com")).toEqual({
      kind: "external",
      url: "https://example.com",
    });
    expect(linkTarget("/docs", "mailto:a@b.c").kind).toBe("external");
  });

  /**
   * Pinned as it is, not as it arguably should be. `isExternal` does not recognise a
   * protocol-relative URL — AGENTS.md records the same quirk where `stripRemoteRefs`
   * had to work around it — so this falls through to the OS hand-off, where the
   * opener's scope rejects it and the click does nothing. That is pre-existing and
   * unchanged by the predicate split; the test is here so it is a known shape rather
   * than a surprise the next time someone reads this function.
   */
  it("does not recognise a protocol-relative URL as external", () => {
    expect(linkTarget("/docs", "//host/path").kind).toBe("handoff");
  });

  it("keeps a fragment-only link inside the document", () => {
    expect(linkTarget("/docs", "#install")).toEqual({ kind: "anchor", fragment: "install" });
  });

  it("opens every Markdown dialect, and MDX, in a tab", () => {
    for (const href of ["./guide.md", "a.markdown", "b.qmd", "c.rmd", "d.mkdn", "e.mdx"]) {
      expect(linkTarget("/docs", href).kind, href).toBe("document");
    }
  });

  it("carries the fragment across to the document it opens", () => {
    expect(linkTarget("/docs", "./guide.md#setup")).toEqual({
      kind: "document",
      path: "/docs/guide.md",
      fragment: "setup",
    });
  });

  /**
   * The behaviour this whole predicate split exists to protect. lindo-md can display
   * these — they appear in the tree, the dialog offers them, dropping one opens it —
   * but a link written inside somebody's Markdown still goes to whatever they use for
   * text files. Widening this to `isOpenablePath` would silently take over links that
   * have opened Notepad or VS Code for as long as the document has existed.
   */
  it("hands plain text to the OS rather than capturing it", () => {
    for (const href of ["notes.txt", "build.log", "readme.rst", "doc.adoc"]) {
      expect(linkTarget("/docs", href).kind, href).toBe("handoff");
    }
  });

  it("hands over anything it cannot render at all", () => {
    for (const href of ["diagram.png", "paper.pdf", "main.rs"]) {
      expect(linkTarget("/docs", href).kind, href).toBe("handoff");
    }
  });

  it("percent-decodes a path before deciding", () => {
    expect(linkTarget("/docs", "My%20Notes.md")).toEqual({
      kind: "document",
      path: "/docs/My Notes.md",
      fragment: "",
    });
  });
});

describe("linkTarget, for wikilinks", () => {
  it("opens the note a bare target names", () => {
    // comrak percent-encodes the space, so this is also the decode path.
    expect(linkTarget("/docs", "Design%20Notes", true)).toEqual({
      kind: "document",
      path: "/docs/Design Notes.md",
      fragment: "",
    });
  });

  it("carries a heading fragment across", () => {
    expect(linkTarget("/docs", "Design%20Notes#Colour", true)).toEqual({
      kind: "document",
      path: "/docs/Design Notes.md",
      fragment: "Colour",
    });
  });

  it("resolves a target that names a folder", () => {
    expect(linkTarget("/docs", "guides/Setup", true)).toEqual({
      kind: "document",
      path: "/docs/guides/Setup.md",
      fragment: "",
    });
  });

  /** A version number is not an extension. See `wikilinkPath`. */
  it("does not mistake a dot in a note's name for an extension", () => {
    expect(linkTarget("/docs", "Notes%20v1.2", true)).toEqual({
      kind: "document",
      path: "/docs/Notes v1.2.md",
      fragment: "",
    });
  });

  it("leaves an extension the target already has", () => {
    expect(linkTarget("/docs", "README.md", true)).toEqual({
      kind: "document",
      path: "/docs/README.md",
      fragment: "",
    });
  });

  /**
   * The same rule as every other link in a document: lindo-md displays plain text
   * but does not capture links to it. A wikilink is not a reason to make an
   * exception, and sharing the tail of `linkTarget` is what guarantees it cannot
   * drift into one.
   */
  it("still hands plain text to the OS", () => {
    expect(linkTarget("/docs", "notes.txt", true)).toEqual({
      kind: "handoff",
      path: "/docs/notes.txt",
    });
  });

  it("is inert on an ordinary link", () => {
    expect(linkTarget("/docs", "Design%20Notes").kind).toBe("handoff");
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

    expect(element.querySelector("img")!.getAttribute("src")).toBe("https://example.com/a.png");
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
    expect(element.querySelector("img")!.getAttribute("src")).toBe("asset:///docs/img/a.png");
  });
});
