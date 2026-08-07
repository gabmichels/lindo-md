import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DOCUMENT_EXTENSIONS,
  TEXT_EXTENSIONS,
  basename,
  dirname,
  dragRegion,
  isExternal,
  isMarkdownPath,
  isOpenablePath,
  resolveRelative,
  splitFragment,
} from "./utils";

describe("resolveRelative", () => {
  it("joins a plain relative path onto the document's directory", () => {
    expect(resolveRelative("/docs", "img/a.png")).toBe("/docs/img/a.png");
    expect(resolveRelative("C:\\docs", "img/a.png")).toBe("C:\\docs\\img\\a.png");
  });

  it("keeps the separator style of the directory it was given", () => {
    // A Windows document must produce Windows paths, or the asset protocol and
    // the Rust side disagree about what file is meant.
    expect(resolveRelative("C:\\a\\b", "./c.md")).toBe("C:\\a\\b\\c.md");
    expect(resolveRelative("/a/b", "./c.md")).toBe("/a/b/c.md");
  });

  it("walks up for ..", () => {
    expect(resolveRelative("/a/b/c", "../d.md")).toBe("/a/b/d.md");
    expect(resolveRelative("/a/b/c", "../../d.md")).toBe("/a/d.md");
    expect(resolveRelative("C:\\a\\b", "..\\c.md")).toBe("C:\\a\\c.md");
  });

  it("leaves URLs, absolute paths and bare anchors alone", () => {
    for (const href of [
      "https://example.com/a.png",
      "http://example.com",
      "mailto:a@b.c",
      "#section",
      "/etc/notes.md",
      "C:/docs/a.md",
    ]) {
      expect(resolveRelative("/docs", href), href).toBe(href);
    }
  });

  it("does not climb above the root", () => {
    expect(resolveRelative("/a", "../../../x.md")).toBe("/x.md");
  });
});

describe("isExternal", () => {
  it("recognizes schemes that the OS browser should handle", () => {
    expect(isExternal("https://example.com")).toBe(true);
    expect(isExternal("mailto:a@b.c")).toBe(true);
  });

  it("treats relative and rooted paths as internal", () => {
    for (const href of ["./a.md", "a.md", "/a/b.md", "#top", "C:/a.md"]) {
      expect(isExternal(href), href).toBe(false);
    }
  });
});

describe("splitFragment", () => {
  it("splits a path and its anchor", () => {
    expect(splitFragment("guide.md#install")).toEqual({
      path: "guide.md",
      fragment: "install",
    });
  });

  it("handles an href with no fragment and a fragment-only href", () => {
    expect(splitFragment("guide.md")).toEqual({ path: "guide.md", fragment: "" });
    expect(splitFragment("#install")).toEqual({ path: "", fragment: "install" });
  });
});

describe("isMarkdownPath", () => {
  it("captures every Markdown dialect, and MDX", () => {
    for (const path of ["a.md", "a.MARKDOWN", "x/y.mdown", "z.mkd", "a.mkdn", "a.qmd", "a.rmd"]) {
      expect(isMarkdownPath(path), path).toBe(true);
    }
    // MDX opens and renders, so a link to one belongs in a tab. That it is
    // read-only once open is a separate question, answered by `doc.editable`.
    expect(isMarkdownPath("a.mdx")).toBe(true);
  });

  it("leaves plain text to the reader's own editor", () => {
    // The whole point of keeping this predicate narrower than `isOpenablePath`.
    // lindo-md can display these; a link written inside someone's document should
    // still open whatever they use for them.
    for (const path of ["notes.txt", "build.log", "a.rst", "a.adoc"]) {
      expect(isMarkdownPath(path), path).toBe(false);
    }
    for (const path of ["a.png", "a.rs", "a"]) {
      expect(isMarkdownPath(path), path).toBe(false);
    }
  });
});

describe("isOpenablePath", () => {
  it("accepts every dialect, MDX and plain text", () => {
    for (const path of ["a.md", "a.qmd", "a.mdx", "notes.TXT", "build.log", "a.rst", "a.adoc"]) {
      expect(isOpenablePath(path), path).toBe(true);
    }
  });

  it("rejects what lindo-md cannot display", () => {
    for (const path of ["a.png", "a.rs", "a.json", "a"]) {
      expect(isOpenablePath(path), path).toBe(false);
    }
  });
});

/**
 * The lists above exist in Rust too, and a comment claiming they agree is not a check.
 * This reads the Rust arrays off disk and compares them, the same way `version.test.ts`
 * pins `package.json` against `Cargo.toml`.
 *
 * It is worth the regex: the previous version of this file carried a hand-copied list
 * and a comment saying it "matches the extensions the Rust side accepts", which nothing
 * verified. Adding an extension on one side and forgetting the other would have shipped
 * a file you can drop on the window but cannot open from the dialog.
 */
describe("the extension lists match the Rust side", () => {
  const rust = readFileSync("src-tauri/src/files.rs", "utf8");

  function rustArray(name: string): string[] {
    const match = new RegExp(`${name}:\\s*\\[&str;\\s*\\d+\\]\\s*=\\s*\\[([^\\]]*)\\]`).exec(rust);
    if (!match?.[1]) throw new Error(`no ${name} array found in src-tauri/src/files.rs`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  }

  it("agrees on which extensions open at all", () => {
    const openable = [
      ...rustArray("MARKDOWN_EXTENSIONS"),
      ...rustArray("MDX_EXTENSIONS"),
      ...rustArray("PLAIN_TEXT_EXTENSIONS"),
    ];
    for (const extension of openable) {
      expect(isOpenablePath(`a.${extension}`), extension).toBe(true);
    }
  });

  it("agrees on which extensions a link may capture", () => {
    for (const extension of [...rustArray("MARKDOWN_EXTENSIONS"), ...rustArray("MDX_EXTENSIONS")]) {
      expect(isMarkdownPath(`a.${extension}`), extension).toBe(true);
    }
    for (const extension of rustArray("PLAIN_TEXT_EXTENSIONS")) {
      expect(isMarkdownPath(`a.${extension}`), extension).toBe(false);
    }
  });

  it("has no extension on the TS side that Rust would refuse to open", () => {
    const rustOpenable = new Set([
      ...rustArray("MARKDOWN_EXTENSIONS"),
      ...rustArray("MDX_EXTENSIONS"),
      ...rustArray("PLAIN_TEXT_EXTENSIONS"),
    ]);
    for (const extension of [...DOCUMENT_EXTENSIONS, ...TEXT_EXTENSIONS]) {
      expect(rustOpenable.has(extension), extension).toBe(true);
    }
    expect(DOCUMENT_EXTENSIONS.length + TEXT_EXTENSIONS.length).toBe(rustOpenable.size);
  });
});

describe("basename / dirname", () => {
  it("splits both separator styles", () => {
    expect(basename("C:\\a\\b\\c.md")).toBe("c.md");
    expect(basename("/a/b/c.md")).toBe("c.md");
    expect(dirname("C:\\a\\b\\c.md")).toBe("C:\\a\\b");
    expect(dirname("/a/b/c.md")).toBe("/a/b");
  });

  it("returns the input when there is no directory part", () => {
    expect(basename("c.md")).toBe("c.md");
  });
});

describe("dragRegion", () => {
  // The macOS bug this helper exists to prevent was the CSS class without the
  // attribute: draggable on Windows, dead on macOS. Neither half is optional.
  it("emits the Chromium class and the WKWebView attribute together", () => {
    expect(dragRegion()).toEqual({
      className: "drag-region",
      "data-tauri-drag-region": true,
    });
  });

  it("keeps the class when the caller adds their own", () => {
    const { className, ...rest } = dragRegion("flex-1");
    expect(className.split(" ").sort()).toEqual(["drag-region", "flex-1"]);
    expect(rest).toEqual({ "data-tauri-drag-region": true });
  });
});
