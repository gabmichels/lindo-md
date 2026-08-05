import { describe, expect, it } from "vitest";

import {
  activateRelative,
  addToGroup,
  closeGroup,
  closeOthers,
  closeTab,
  closeToRight,
  groupTabs,
  moveGroup,
  moveTab,
  normalize,
  openTab,
  promotePreview,
  removeFromGroup,
  setGroupCollapsed,
  setTabPath,
  ungroup,
  type Session,
  type Tab,
  type TabGroup,
} from "./model";

/**
 * Sessions are written and asserted as a compact spec — `"a b (G c d) e"` means
 * five tabs with `c` and `d` in group `G`. Order and grouping are the two things
 * every test here cares about, and this puts both on one line.
 */
function build(spec: string): Session {
  const tabs: Tab[] = [];
  const groups: TabGroup[] = [];
  let current: string | null = null;

  for (const token of spec.split(/\s+/).filter(Boolean)) {
    if (token.startsWith("(")) {
      current = token.slice(1);
      groups.push({ id: current, name: current, color: "clay", collapsed: false });
      continue;
    }
    const closes = token.endsWith(")");
    const id = closes ? token.slice(0, -1) : token;
    tabs.push({
      id,
      path: `/${id}.md`,
      groupId: current,
      preview: false,
      openerId: null,
    });
    if (closes) current = null;
  }

  return normalize({ tabs, groups, activeTabId: tabs[0]?.id ?? null });
}

function render(session: Session): string {
  let out = "";
  let open: string | null = null;

  for (const tab of session.tabs) {
    if (tab.groupId !== open) {
      if (open !== null) out += ")";
      open = tab.groupId;
      if (open !== null) out += ` (${open}`;
    }
    out += ` ${tab.id}`;
  }

  return (open === null ? out : `${out})`).trim();
}

/** Every group's members must occupy one unbroken run. */
function isContiguous(session: Session): boolean {
  const seen = new Set<string>();
  let previous: string | null = null;

  for (const tab of session.tabs) {
    if (tab.groupId !== previous && tab.groupId !== null) {
      if (seen.has(tab.groupId)) return false;
      seen.add(tab.groupId);
    }
    previous = tab.groupId;
  }
  return true;
}

describe("normalize", () => {
  it("drops duplicate ids and duplicate paths, keeping the first", () => {
    const session = normalize({
      tabs: [
        { id: "a", path: "/a.md", groupId: null, preview: false, openerId: null },
        { id: "a", path: "/b.md", groupId: null, preview: false, openerId: null },
        { id: "c", path: "/a.md", groupId: null, preview: false, openerId: null },
      ],
      groups: [],
      activeTabId: "a",
    });
    expect(render(session)).toBe("a");
  });

  it("nulls a groupId that names no group, and deletes empty groups", () => {
    const session = normalize({
      tabs: [{ id: "a", path: "/a.md", groupId: "ghost", preview: false, openerId: null }],
      groups: [{ id: "G", name: "G", color: "clay", collapsed: false }],
      activeTabId: "a",
    });
    expect(render(session)).toBe("a");
    expect(session.groups).toEqual([]);
  });

  it("pulls an interleaved group back into one run, anchored at its first member", () => {
    // A B A B must always become A A B B — never B B A A — or a hand-edited
    // config.json would load differently depending on nothing in particular.
    const session = normalize({
      tabs: [
        { id: "a", path: "/a.md", groupId: "A", preview: false, openerId: null },
        { id: "b", path: "/b.md", groupId: "B", preview: false, openerId: null },
        { id: "c", path: "/c.md", groupId: "A", preview: false, openerId: null },
        { id: "d", path: "/d.md", groupId: "B", preview: false, openerId: null },
      ],
      groups: [
        { id: "A", name: "A", color: "clay", collapsed: false },
        { id: "B", name: "B", color: "moss", collapsed: false },
      ],
      activeTabId: "a",
    });
    expect(render(session)).toBe("(A a c) (B b d)");
    expect(isContiguous(session)).toBe(true);
  });

  it("keeps at most one preview tab", () => {
    const session = normalize({
      tabs: [
        { id: "a", path: "/a.md", groupId: null, preview: true, openerId: null },
        { id: "b", path: "/b.md", groupId: null, preview: true, openerId: null },
      ],
      groups: [],
      activeTabId: "a",
    });
    expect(session.tabs.map((tab) => tab.preview)).toEqual([true, false]);
  });

  it("nulls an openerId that is dangling or self-referential", () => {
    const session = normalize({
      tabs: [
        { id: "a", path: "/a.md", groupId: null, preview: false, openerId: "a" },
        { id: "b", path: "/b.md", groupId: null, preview: false, openerId: "gone" },
      ],
      groups: [],
      activeTabId: "a",
    });
    expect(session.tabs.map((tab) => tab.openerId)).toEqual([null, null]);
  });

  it("keeps the active tab real, and null only when nothing is open", () => {
    expect(normalize({ ...build("a b"), activeTabId: "gone" }).activeTabId).toBe("a");
    expect(normalize({ tabs: [], groups: [], activeTabId: "a" }).activeTabId).toBe(null);
  });

  it("expands a collapsed group that holds the active tab", () => {
    // An invisible active tab means no tab looks selected anywhere.
    const collapsed = build("a (G b c)");
    const session = normalize({
      ...collapsed,
      groups: collapsed.groups.map((group) => ({ ...group, collapsed: true })),
      activeTabId: "b",
    });
    expect(session.groups[0]!.collapsed).toBe(false);
  });

  it("coerces an unknown colour and trims an overlong name", () => {
    const session = normalize({
      tabs: [{ id: "a", path: "/a.md", groupId: "G", preview: false, openerId: null }],
      groups: [
        {
          id: "G",
          name: `  ${"x".repeat(120)}  `,
          color: "chartreuse" as never,
          collapsed: false,
        },
      ],
      activeTabId: "a",
    });
    expect(session.groups[0]!.color).toBe("slate");
    expect(session.groups[0]!.name).toHaveLength(60);
  });

  it("is idempotent", () => {
    const hostile: Session[] = [
      build("a b (G c d) e"),
      {
        tabs: [
          { id: "a", path: "/a.md", groupId: "A", preview: true, openerId: "b" },
          { id: "b", path: "/b.md", groupId: "B", preview: true, openerId: "a" },
          { id: "c", path: "/a.md", groupId: "A", preview: false, openerId: "x" },
          { id: "d", path: "/d.md", groupId: "gone", preview: false, openerId: "d" },
        ],
        groups: [
          { id: "A", name: " A ", color: "clay", collapsed: true },
          { id: "B", name: "B", color: "bad" as never, collapsed: true },
          { id: "unused", name: "", color: "teal", collapsed: false },
        ],
        activeTabId: "nope",
      },
      { tabs: [], groups: [], activeTabId: "ghost" },
    ];

    for (const session of hostile) {
      const once = normalize(session);
      expect(normalize(once)).toEqual(once);
      expect(isContiguous(once)).toBe(true);
    }
  });
});

describe("openTab", () => {
  it("opens just after the active tab, like a browser", () => {
    const session = openTab(build("a b c"), "/new.md", { id: "n" });
    expect(render(session)).toBe("a n b c");
    expect(session.activeTabId).toBe("n");
  });

  it("activates an already-open path instead of opening it twice", () => {
    const session = openTab(build("a b"), "/b.md", { id: "other" });
    expect(render(session)).toBe("a b");
    expect(session.activeTabId).toBe("b");
  });

  it("reuses the preview slot rather than accumulating tabs", () => {
    const first = openTab(build("a"), "/p.md", { id: "p", preview: true });
    const second = openTab(first, "/q.md", { id: "q", preview: true });
    expect(render(second)).toBe("a q");
  });

  it("promotes a preview tab when the same file is opened permanently", () => {
    const previewing = openTab(build("a"), "/p.md", { id: "p", preview: true });
    const pinned = openTab(previewing, "/p.md", { id: "ignored" });
    expect(pinned.tabs.find((tab) => tab.id === "p")!.preview).toBe(false);
  });

  it("keeps a link followed from inside a group in that group", () => {
    const session = openTab(build("(G a b) c"), "/new.md", {
      id: "n",
      openerId: "a",
    });
    expect(render(session)).toBe("(G a n b) c");
  });

  it("pushes an unrelated open out of a group rather than joining it", () => {
    // Landing mid-group by accident must not silently change membership.
    const session = openTab(build("(G a b) c"), "/new.md", { id: "n", at: 1 });
    expect(render(session)).toBe("n (G a b) c");
  });
});

describe("closeTab", () => {
  it("returns to the tab the closed one was opened from", () => {
    const opened = openTab(build("a b c"), "/new.md", { id: "n", openerId: "a" });
    expect(closeTab(opened, "n").activeTabId).toBe("a");
  });

  it("prefers a surviving group-mate over the plain right neighbour", () => {
    // Closing inside a group should feel like staying in the group.
    const session = closeTab({ ...build("(G a b) c"), activeTabId: "b" }, "b");
    expect(session.activeTabId).toBe("a");
  });

  it("falls back to the right neighbour, then the left", () => {
    expect(closeTab({ ...build("a b c"), activeTabId: "b" }, "b").activeTabId).toBe("c");
    expect(closeTab({ ...build("a b"), activeTabId: "b" }, "b").activeTabId).toBe("a");
  });

  it("leaves nothing active once the last tab is gone", () => {
    const session = closeTab(build("a"), "a");
    expect(session.tabs).toEqual([]);
    expect(session.activeTabId).toBe(null);
  });

  it("deletes the group when its last tab closes", () => {
    const session = closeTab(build("(G a) b"), "a");
    expect(session.groups).toEqual([]);
    expect(render(session)).toBe("b");
  });

  it("ignores a tab that is not open", () => {
    const before = build("a b");
    expect(closeTab(before, "ghost")).toBe(before);
  });
});

describe("closeOthers / closeToRight / closeGroup", () => {
  it("closes everything but one tab", () => {
    const session = closeOthers(build("a (G b c) d"), "b");
    expect(render(session)).toBe("(G b)");
    expect(session.activeTabId).toBe("b");
  });

  it("closes everything after a tab, keeping the active one if it survives", () => {
    expect(render(closeToRight(build("a b c d"), "b"))).toBe("a b");
    expect(closeToRight({ ...build("a b c"), activeTabId: "c" }, "a").activeTabId).toBe("a");
  });

  it("closes a whole group and activates what slid into its place", () => {
    const session = closeGroup({ ...build("a (G b c) d"), activeTabId: "b" }, "G");
    expect(render(session)).toBe("a d");
    expect(session.activeTabId).toBe("d");
  });
});

describe("moveTab — the cases that make contiguity hard", () => {
  it("drags a tab out of the middle of its group without splitting the run", () => {
    const session = moveTab(build("a (G b c d) e"), "c", 5, { kind: "none" });
    expect(render(session)).toBe("a (G b d) e c");
    expect(isContiguous(session)).toBe(true);
  });

  it("drags an ungrouped tab into the middle of a group, joining it", () => {
    const session = moveTab(build("a (G b c) d"), "d", 2, {
      kind: "join",
      groupId: "G",
    });
    expect(render(session)).toBe("a (G b d c)");
  });

  it("snaps to the group's edge when the intent is not to join", () => {
    // You cannot punch a hole through a group by accident.
    const session = moveTab(build("a (G b c) d"), "d", 2, { kind: "none" });
    expect(render(session)).toBe("a d (G b c)");
    expect(isContiguous(session)).toBe(true);
  });

  it("keeps a grouped tab in its group when reordering within the strip", () => {
    const session = moveTab(build("a (G b c) d"), "b", 4);
    expect(render(session)).toBe("a (G c b) d");
  });

  it("lets the last member of a group leave, taking the group with it", () => {
    const session = moveTab(build("(G a) b c"), "a", 3, { kind: "none" });
    expect(render(session)).toBe("b c a");
    expect(session.groups).toEqual([]);
  });

  it("reorders plain tabs both ways", () => {
    expect(render(moveTab(build("a b c"), "a", 3))).toBe("b c a");
    expect(render(moveTab(build("a b c"), "c", 0))).toBe("c a b");
  });
});

describe("moveGroup", () => {
  it("moves the whole run past another group", () => {
    const session = moveGroup(build("(G a b) (H c d)"), "G", 4);
    expect(render(session)).toBe("(H c d) (G a b)");
  });

  it("never lands inside another group", () => {
    const session = moveGroup(build("(G a b) (H c d)"), "G", 3);
    expect(isContiguous(session)).toBe(true);
    expect(render(session)).toBe("(G a b) (H c d)");
  });
});

describe("grouping", () => {
  it("forms a group at the leftmost member and pulls the others adjacent", () => {
    const session = groupTabs(build("a b c"), ["a", "c"], { id: "G" });
    expect(render(session)).toBe("(G a c) b");
  });

  it("does not split an existing group to make room", () => {
    const session = groupTabs(build("(H a b) c d"), ["c", "d"], { id: "G" });
    expect(render(session)).toBe("(H a b) (G c d)");
    expect(isContiguous(session)).toBe(true);
  });

  it("picks the least-used colour so a new group looks new", () => {
    const one = groupTabs(build("a b"), ["a"], { id: "G" });
    const two = groupTabs(one, ["b"], { id: "H" });
    expect(two.groups.map((group) => group.color)).toEqual(["clay", "amber"]);
  });

  it("adds a tab to an existing group at either end", () => {
    expect(render(addToGroup(build("(G a b) c"), "c", "G"))).toBe("(G a b c)");
    expect(render(addToGroup(build("(G a b) c"), "c", "G", "start"))).toBe("(G c a b)");
  });

  it("parks a removed tab immediately outside the run", () => {
    expect(render(removeFromGroup(build("(G a b c)"), "b"))).toBe("(G a c) b");
    expect(render(removeFromGroup(build("(G a b c)"), "b", "left"))).toBe("b (G a c)");
  });

  it("dissolves a group without moving anything", () => {
    const session = ungroup(build("a (G b c) d"), "G");
    expect(render(session)).toBe("a b c d");
  });
});

describe("collapsing", () => {
  it("moves activation out of the group being collapsed", () => {
    const session = setGroupCollapsed({ ...build("a (G b c) d"), activeTabId: "b" }, "G", true);
    expect(session.activeTabId).toBe("d");
    expect(session.groups[0]!.collapsed).toBe(true);
  });

  it("refuses to collapse when there is nowhere for the active tab to go", () => {
    const before = { ...build("(G a b)"), activeTabId: "a" };
    expect(setGroupCollapsed(before, "G", true)).toBe(before);
  });

  it("skips collapsed members when cycling", () => {
    const collapsed = setGroupCollapsed(build("a (G b c) d"), "G", true);
    expect(activateRelative(collapsed, 1).activeTabId).toBe("d");
    expect(activateRelative(collapsed, -1).activeTabId).toBe("d");
  });
});

describe("activateRelative", () => {
  it("wraps at both ends", () => {
    expect(activateRelative(build("a b c"), -1).activeTabId).toBe("c");
    expect(activateRelative({ ...build("a b c"), activeTabId: "c" }, 1).activeTabId).toBe("a");
  });
});

describe("setTabPath", () => {
  it("re-points a tab without moving it or changing its group", () => {
    const session = setTabPath(build("a (G b c)"), "b", "/elsewhere.md");
    expect(render(session)).toBe("a (G b c)");
    expect(session.tabs.find((tab) => tab.id === "b")!.path).toBe("/elsewhere.md");
  });

  it("refuses when another tab already holds that path", () => {
    // The caller activates that tab instead — one file open twice would show
    // the same bytes in two places.
    const before = build("a b");
    expect(setTabPath(before, "a", "/b.md")).toBe(before);
  });
});

describe("promotePreview", () => {
  it("pins a preview tab", () => {
    const previewing = openTab(build("a"), "/p.md", { id: "p", preview: true });
    expect(promotePreview(previewing, "p").tabs.find((t) => t.id === "p")!.preview).toBe(false);
  });
});
