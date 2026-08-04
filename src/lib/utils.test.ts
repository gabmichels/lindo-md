import { describe, expect, it } from "vitest";

import {
  basename,
  dirname,
  isExternal,
  isMarkdownPath,
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
  it("matches the extensions the Rust side accepts", () => {
    for (const path of ["a.md", "a.MARKDOWN", "x/y.mdown", "z.mkd"]) {
      expect(isMarkdownPath(path), path).toBe(true);
    }
    for (const path of ["a.png", "a.mdx", "a"]) {
      expect(isMarkdownPath(path), path).toBe(false);
    }
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
