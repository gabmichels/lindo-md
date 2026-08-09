import { describe, expect, it, vi, type Mock } from "vitest";

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
  // Both separators, because half these cases are Windows paths — this is a
  // Windows-first app and `folder.length + 1` arithmetic is where that bites.
  return { name: path.split(/[/\\]/).at(-1) ?? path, path, isDir: false, children: [] };
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

  it("opens on documents with nothing typed", () => {
    expect(parseQuery("")).toEqual({ mode: "open", query: "" });
  });

  /**
   * The accepted cost, written down so it is a decision rather than a
   * discovery: a prefix is consumed unconditionally, so a file named
   * `@types.md` cannot be reached by typing its first character, and there is
   * no escape. Sublime behaves the same way, and a leading `@` in a filename is
   * rarer than a reader wanting the headings.
   */
  it("has no escape hatch — a leading prefix is always a mode", () => {
    expect(parseQuery("@types.md").mode).toBe("headings");
    expect(parseQuery(">>x")).toEqual({ mode: "commands", query: ">x" });
  });
});

describe("rank", () => {
  it("keeps every item when nothing is typed, in the order given", () => {
    const items = [item({ label: "b" }), item({ label: "a" })];
    expect(rank(items, "", 10).map((result) => result.item.label)).toEqual(["b", "a"]);
  });

  /** With nothing typed every score ties, so the real order is group first and
   *  insertion order within a group — which is what the palette opens showing. */
  it("orders an untyped list by group, then by the order given", () => {
    const items = [
      item({ id: "f", label: "f", group: "Files" }),
      item({ id: "r1", label: "r1", group: "Recent" }),
      item({ id: "t", label: "t", group: "Open tabs" }),
      item({ id: "r2", label: "r2", group: "Recent" }),
    ];
    expect(rank(items, "", 10).map((result) => result.item.id)).toEqual(["t", "r1", "r2", "f"]);
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

  /**
   * A name match is the one the reader meant; a folder match is a fallback.
   *
   * Both match the query equally well — `guide` is the whole of one item's
   * folder and the stem of the other's name — so the label can only win because
   * of `DETAIL_PENALTY`. Set that to zero and the shorter string wins on the
   * length tie-break, which is the detail: the assertion flips, as it should.
   */
  it("ranks a label match above an equally good detail match", () => {
    const items = [
      item({ id: "detail", label: "index.md", detail: "guide" }),
      item({ id: "label", label: "guide.md", detail: "docs" }),
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

  /** Which eight, not just how many — slicing before the sort also returns a
   *  list of the right length, and it returns the wrong eight. */
  it("keeps the best matches when it honours the limit", () => {
    const items = [
      ...Array.from({ length: 20 }, (_, index) => item({ label: `n-o-t-e-${index}.md` })),
      item({ id: "best", label: "note.md" }),
    ];
    const results = rank(items, "note", 3);
    expect(results).toHaveLength(3);
    expect(results[0]?.item.id).toBe("best");
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

  it("opens the full path, not the name it is labelled with", () => {
    const open = vi.fn();
    recentItems(["/w/deep/b.md"], new Set(), open)[0]?.run();
    expect(open).toHaveBeenCalledWith("/w/deep/b.md");
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

  /** The label is the basename and the detail is relative, but only the
   *  absolute path can actually be opened. */
  it("opens the absolute path", () => {
    const open = vi.fn();
    fileItems(tree, "/w", new Set(), open)[0]?.run();
    expect(open).toHaveBeenCalledWith("/w/docs/guide.md");
  });

  describe("the folder prefix has to end at a separator", () => {
    it("does not treat a sibling folder as the open one", () => {
      // `/works/notes.md` starts with `/w`, and slicing on length alone
      // reported its folder as `rks`. It is not under the open folder at all,
      // so it keeps its absolute one.
      const items = fileItems([file("/works/notes.md")], "/w", new Set(), () => undefined);
      expect(items[0]?.detail).toBe("/works");
    });

    it("handles a folder that already ends in a separator", () => {
      const items = fileItems([file("C:\\a.md")], "C:\\", new Set(), () => undefined);
      expect(items[0]?.label).toBe("a.md");
      expect(items[0]?.detail).toBe(undefined);
    });

    it("takes Windows separators off a Windows path", () => {
      const items = fileItems([file("C:\\w\\docs\\a.md")], "C:\\w", new Set(), () => undefined);
      expect(items[0]?.detail).toBe("docs");
    });
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

  /** The row id and the anchor are deliberately different strings. Jumping to
   *  the row id scrolls nowhere, silently. */
  it("jumps to the heading's anchor, not to the row's id", () => {
    const jump = vi.fn();
    const items = headingItems(toc, jump);
    items[1]?.run();
    expect(jump).toHaveBeenCalledWith("detail");
    expect(items[1]?.id).not.toBe("detail");
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

  it("picks the theme by its own id, unprefixed", () => {
    const pick = vi.fn();
    themeItems([], [{ id: "mine", name: "Mine" }], pick)[0]?.run();
    expect(pick).toHaveBeenCalledWith("mine");
  });

  /** `config.json` is a file the reader edits, so a custom theme called `house`
   *  is reachable. Two rows with one id is a duplicate key and an ambiguous
   *  `aria-activedescendant`. */
  it("keeps a custom theme out of the presets' id namespace", () => {
    const items = themeItems(
      [{ id: "house", name: "House", note: "ours" }],
      [{ id: "house", name: "Mine" }],
      () => undefined,
    );
    expect(new Set(items.map((entry) => entry.id)).size).toBe(2);
  });
});

describe("commandItems", () => {
  /**
   * An explicit object literal, not a cast over an array of names.
   *
   * The cast that was here is the one thing that could defeat the whole design:
   * add an action to `PaletteActions` and a row that calls it, forget the
   * fixture entry, and the test file still compiles while `run` is `undefined`.
   * The palette would close and silently do nothing. Written this way, the
   * missing key is a red typecheck.
   */
  const freshActions = (): Record<keyof PaletteActions, Mock> => ({
    onOpenFile: vi.fn(),
    onOpenFolder: vi.fn(),
    onNewTab: vi.fn(),
    onCloseTab: vi.fn(),
    onReopenTab: vi.fn(),
    onCycleTab: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onFind: vi.fn(),
    onToggleSource: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onExport: vi.fn(),
    onExportAnnotated: vi.fn(),
    onPrint: vi.fn(),
    onToggleCompare: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onAppearance: vi.fn(),
    onSettings: vi.fn(),
    onAbout: vi.fn(),
    onToggleRail: vi.fn(),
    onToggleNotes: vi.fn(),
    onRevealInFolder: vi.fn(),
  });

  const actions = freshActions();

  const state: PaletteState = {
    hasDocument: true,
    editable: true,
    sourceMode: false,
    compareOpen: false,
    canGoBack: true,
    canGoForward: true,
    railCollapsed: false,
    notesOpen: false,
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
    expect(labels({ notesOpen: true })).toContain("Hide notes");
    expect(labels({ notesOpen: false })).toContain("Show notes");
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

  /**
   * Every row, not a representative one.
   *
   * The bug this exists for is a copy-paste in a list of twenty-three
   * near-identical entries: `onCycleTab(1)` on the row labelled "Previous tab",
   * or `onZoomIn` wired to "Zoom out". Both produce a palette that looks
   * perfect, and neither is visible in a diff read at speed.
   */
  const WIRING: [id: string, action: keyof PaletteActions, args?: unknown[]][] = [
    ["cmd:open-file", "onOpenFile"],
    ["cmd:open-folder", "onOpenFolder"],
    ["cmd:new-tab", "onNewTab"],
    ["cmd:close-tab", "onCloseTab"],
    ["cmd:reopen-tab", "onReopenTab"],
    ["cmd:next-tab", "onCycleTab", [1]],
    ["cmd:previous-tab", "onCycleTab", [-1]],
    ["cmd:back", "onBack"],
    ["cmd:forward", "onForward"],
    ["cmd:find", "onFind"],
    ["cmd:toggle-source", "onToggleSource"],
    ["cmd:undo", "onUndo"],
    ["cmd:redo", "onRedo"],
    ["cmd:export", "onExport"],
    ["cmd:export-annotated", "onExportAnnotated"],
    ["cmd:print", "onPrint"],
    ["cmd:compare", "onToggleCompare"],
    ["cmd:reveal", "onRevealInFolder"],
    ["cmd:zoom-in", "onZoomIn"],
    ["cmd:zoom-out", "onZoomOut"],
    ["cmd:zoom-reset", "onZoomReset"],
    ["cmd:rail", "onToggleRail"],
    ["cmd:notes", "onToggleNotes"],
    ["cmd:appearance", "onAppearance"],
    ["cmd:settings", "onSettings"],
    ["cmd:about", "onAbout"],
  ];

  it.each(WIRING)("%s runs %s, and nothing else", (id, action, args) => {
    const spies = freshActions();
    commandItems(spies, state)
      .find((entry) => entry.id === id)
      ?.run();

    expect(spies[action], `${id} did not run ${action}`).toHaveBeenCalledTimes(1);
    if (args) expect(spies[action]).toHaveBeenCalledWith(...args);
    for (const [name, spy] of Object.entries(spies)) {
      if (name !== action) expect(spy, `${id} also ran ${name}`).not.toHaveBeenCalled();
    }
  });

  /** The other direction: an action wired to the keyboard but never given a row
   *  is exactly the drift the shared `actions` object is meant to prevent. */
  it("gives every action a row", () => {
    const wired = new Set(WIRING.map(([, action]) => action));
    expect([...Object.keys(freshActions())].filter((name) => !wired.has(name as never))).toEqual(
      [],
    );
  });

  it("offers a row for every command the table lists", () => {
    const ids = commandItems(actions, state).map((entry) => entry.id);
    expect(ids).toEqual(WIRING.map(([id]) => id));
  });

  it("gives every row a unique id", () => {
    const ids = commandItems(actions, state).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Chords are a hand-written string here and a `case` in `App.tsx`'s switch,
   * and nothing relates the two. This does not prove a row's chord is bound —
   * it freezes the set, so changing one is a deliberate line in a diff rather
   * than a silent lie on a row. The honest fix is a shared chord table; until
   * then this is the net.
   */
  it("advertises exactly these chords", () => {
    const chords = Object.fromEntries(
      commandItems(actions, state)
        .filter((entry) => entry.chord !== undefined)
        .map((entry) => [entry.id, entry.chord]),
    );
    expect(chords).toEqual({
      "cmd:open-file": "Ctrl+O",
      "cmd:open-folder": "Ctrl+Shift+O",
      "cmd:new-tab": "Ctrl+T",
      "cmd:close-tab": "Ctrl+W",
      "cmd:reopen-tab": "Ctrl+Shift+T",
      "cmd:next-tab": "Ctrl+Tab",
      "cmd:previous-tab": "Ctrl+Shift+Tab",
      "cmd:back": "Ctrl+[",
      "cmd:forward": "Ctrl+]",
      "cmd:find": "Ctrl+F",
      "cmd:toggle-source": "Ctrl+E",
      "cmd:undo": "Ctrl+Z",
      "cmd:redo": "Ctrl+Shift+Z",
      "cmd:export": "Ctrl+Shift+E",
      "cmd:print": "Ctrl+P",
      "cmd:compare": "Ctrl+\\",
      "cmd:zoom-in": "Ctrl++",
      "cmd:zoom-out": "Ctrl+−",
      "cmd:zoom-reset": "Ctrl+0",
      "cmd:notes": "Ctrl+Shift+A",
      "cmd:appearance": "Ctrl+Shift+,",
      "cmd:settings": "Ctrl+,",
    });
  });
});
