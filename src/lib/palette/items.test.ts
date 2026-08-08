import { describe, expect, it, vi } from "vitest";

import type { TreeNode } from "@/lib/ipc";
import {
  commandItems,
  fileItems,
  headingItems,
  parseQuery,
  rank,
  recentItems,
  tabItems,
  themeItems,
  type PaletteActions,
  type PaletteItem,
  type PaletteState,
} from "@/lib/palette/items";

function item(partial: Partial<PaletteItem> & { label: string }): PaletteItem {
  return {
    id: partial.id ?? partial.label,
    group: partial.group ?? "Files",
    run: partial.run ?? (() => undefined),
    ...partial,
  };
}

function dir(name: string, children: TreeNode[]): TreeNode {
  return { name, path: `/w/${name}`, isDir: true, children };
}

function file(path: string): TreeNode {
  return { name: path.split("/").at(-1) ?? path, path, isDir: false, children: [] };
}

describe("parseQuery", () => {
  it("reads the Sublime prefixes", () => {
    expect(parseQuery(">theme")).toEqual({ mode: "commands", query: "theme" });
    expect(parseQuery("@intro")).toEqual({ mode: "headings", query: "intro" });
    expect(parseQuery("notes")).toEqual({ mode: "open", query: "notes" });
  });

  it("treats a bare prefix as that mode with nothing typed yet", () => {
    expect(parseQuery(">")).toEqual({ mode: "commands", query: "" });
    expect(parseQuery("> ")).toEqual({ mode: "commands", query: "" });
  });
});

describe("rank", () => {
  it("keeps every item when nothing is typed, in the order given", () => {
    const items = [item({ label: "b" }), item({ label: "a" })];
    expect(rank(items, "", 10).map((result) => result.item.label)).toEqual(["b", "a"]);
  });

  it("drops what does not match", () => {
    const items = [item({ label: "readme.md" }), item({ label: "changelog.md" })];
    expect(rank(items, "read", 10).map((result) => result.item.label)).toEqual(["readme.md"]);
  });

  it("matches the detail as well as the label", () => {
    const items = [item({ label: "index.md", detail: "docs/guide" })];
    expect(rank(items, "guide", 10)).toHaveLength(1);
  });

  it("matches a keyword that is never shown", () => {
    const items = [item({ label: "Appearance…", keywords: "theme typography" })];
    const [result] = rank(items, "typography", 10);
    expect(result?.item.label).toBe("Appearance…");
    // Nothing in the label matched, so nothing in the label is marked.
    expect(result?.labelRanges).toEqual([]);
  });

  /** A name match is the one the reader meant; a folder match is a fallback. */
  it("ranks a label match above a detail match on the same word", () => {
    const items = [
      item({ id: "detail", label: "index.md", detail: "guide/" }),
      item({ id: "label", label: "guide.md", detail: "docs/" }),
    ];
    expect(rank(items, "guide", 10)[0]?.item.id).toBe("label");
  });

  it("breaks a tie by group order", () => {
    const items = [
      item({ id: "file", label: "notes.md", group: "Files" }),
      item({ id: "tab", label: "notes.md", group: "Open tabs" }),
    ];
    expect(rank(items, "notes", 10)[0]?.item.id).toBe("tab");
  });

  it("honours the limit", () => {
    const items = Array.from({ length: 50 }, (_, index) => item({ label: `note-${index}.md` }));
    expect(rank(items, "note", 8)).toHaveLength(8);
  });
});

describe("tabItems", () => {
  it("leaves out the tab already being read", () => {
    const items = tabItems(
      [
        { id: "1", path: "/w/a.md" },
        { id: "2", path: "/w/b.md" },
      ],
      "1",
      () => undefined,
    );
    expect(items.map((entry) => entry.label)).toEqual(["b.md"]);
  });

  it("activates the tab it stands for", () => {
    const activate = vi.fn();
    tabItems([{ id: "7", path: "/w/a.md" }], null, activate)[0]?.run();
    expect(activate).toHaveBeenCalledWith("7");
  });
});

describe("recentItems", () => {
  it("leaves out files that already have a tab", () => {
    const items = recentItems(["/w/a.md", "/w/b.md"], new Set(["/w/a.md"]), () => undefined);
    expect(items.map((entry) => entry.label)).toEqual(["b.md"]);
  });
});

describe("fileItems", () => {
  const tree = [dir("docs", [file("/w/docs/guide.md"), file("/w/docs/api.md")]), file("/w/top.md")];

  it("walks into folders and offers every document", () => {
    const items = fileItems(tree, "/w", new Set(), () => undefined);
    expect(items.map((entry) => entry.label)).toEqual(["guide.md", "api.md", "top.md"]);
  });

  it("shows the folder relative to the one that is open", () => {
    const items = fileItems(tree, "/w", new Set(), () => undefined);
    expect(items[0]?.detail).toBe("docs");
  });

  it("shows no folder for a file at the root of the open folder", () => {
    const items = fileItems(tree, "/w", new Set(), () => undefined);
    expect(items.at(-1)?.detail).toBeUndefined();
  });

  /** Otherwise the same document is offered as a tab and as a file, and the
   *  second row does nothing the first would not. */
  it("skips what a caller has already listed", () => {
    const items = fileItems(tree, "/w", new Set(["/w/docs/guide.md"]), () => undefined);
    expect(items.map((entry) => entry.label)).toEqual(["api.md", "top.md"]);
  });
});

describe("headingItems", () => {
  const toc = [
    { level: 1, text: "Title", id: "title" },
    { level: 2, text: "Detail", id: "detail" },
  ];

  it("indents by depth below the shallowest heading", () => {
    expect(headingItems(toc, () => undefined).map((entry) => entry.label)).toEqual([
      "Title",
      "  Detail",
    ]);
  });

  it("indents from the document's own shallowest level, not from h1", () => {
    const deep = [
      { level: 2, text: "Title", id: "a" },
      { level: 3, text: "Detail", id: "b" },
    ];
    expect(headingItems(deep, () => undefined)[0]?.label).toBe("Title");
  });

  it("keeps two headings with the same anchor apart", () => {
    const repeated = [
      { level: 2, text: "Notes", id: "notes" },
      { level: 2, text: "Notes", id: "notes" },
    ];
    const items = headingItems(repeated, () => undefined);
    expect(items[0]?.id).not.toBe(items[1]?.id);
  });
});

describe("themeItems", () => {
  it("offers presets and the reader's own themes", () => {
    const items = themeItems(
      [{ id: "house", name: "House", note: "warm bone paper" }],
      [{ id: "mine", name: "Mine" }],
      () => undefined,
    );
    expect(items.map((entry) => entry.label)).toEqual(["Theme: House", "Theme: Mine"]);
    expect(items.map((entry) => entry.detail)).toEqual(["warm bone paper", "Your theme"]);
  });
});

describe("commandItems", () => {
  const actions = Object.fromEntries(
    (
      [
        "onOpenFile",
        "onOpenFolder",
        "onNewTab",
        "onCloseTab",
        "onReopenTab",
        "onCycleTab",
        "onBack",
        "onForward",
        "onFind",
        "onToggleSource",
        "onUndo",
        "onRedo",
        "onExport",
        "onPrint",
        "onZoomIn",
        "onZoomOut",
        "onZoomReset",
        "onAppearance",
        "onSettings",
        "onAbout",
        "onToggleRail",
        "onRevealInFolder",
      ] as const
    ).map((name) => [name, vi.fn()]),
  ) as unknown as PaletteActions;

  const state: PaletteState = {
    hasDocument: true,
    editable: true,
    sourceMode: false,
    canGoBack: true,
    canGoForward: true,
    railCollapsed: false,
    mod: "Ctrl",
  };

  const labels = (overrides: Partial<PaletteState> = {}) =>
    commandItems(actions, { ...state, ...overrides }).map((entry) => entry.label);

  /**
   * The gate the keyboard shortcuts apply, applied here for the same reason: a
   * palette row is not stopped by a hidden toolbar button, and offering an edit
   * on a file `files::save` will refuse is how someone loses one.
   */
  it("does not offer editing commands on a read-only document", () => {
    expect(labels({ editable: false })).not.toContain("Undo");
    expect(labels({ editable: false })).not.toContain("Edit as Markdown");
    expect(labels()).toContain("Undo");
  });

  it("does not offer navigation with no history to walk", () => {
    expect(labels({ canGoBack: false })).not.toContain("Back");
  });

  it("does not offer document commands with nothing open", () => {
    expect(labels({ hasDocument: false })).not.toContain("Find in document");
    expect(labels({ hasDocument: false })).toContain("Open file…");
  });

  it("names a toggle after what it will do, not after the state it is in", () => {
    expect(labels({ railCollapsed: true })).toContain("Show the sidebar");
    expect(labels({ railCollapsed: false })).toContain("Hide the sidebar");
    expect(labels({ sourceMode: true })).toContain("Show the rendered document");
  });

  it("spells chords with the host's own modifier", () => {
    const [open] = commandItems(actions, { ...state, mod: "⌘" });
    expect(open?.chord).toBe("⌘+O");
  });

  it("never leaves the availability flag on a built item", () => {
    for (const entry of commandItems(actions, state)) {
      expect(entry).not.toHaveProperty("when");
    }
  });

  it("runs the action it names", () => {
    commandItems(actions, state)
      .find((entry) => entry.label === "Open file…")
      ?.run();
    expect(actions.onOpenFile).toHaveBeenCalled();
  });
});
