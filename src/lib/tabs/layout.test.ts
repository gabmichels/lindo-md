import { describe, expect, it } from "vitest";

import {
  DRAG_RESERVE,
  GAP,
  PILL_MAX,
  PILL_MIN,
  PLUS_W,
  TAB_MAX,
  TAB_MIN,
  clampPill,
  layoutTabs,
  pillWidthFor,
} from "./layout";
import { normalize, setGroupCollapsed, type Session, type Tab } from "./model";

function build(count: number, groupFrom?: number, groupTo?: number): Session {
  const tabs: Tab[] = Array.from({ length: count }, (_, index) => ({
    id: `t${index}`,
    path: `/t${index}.md`,
    groupId: groupFrom !== undefined && index >= groupFrom && index <= groupTo! ? "G" : null,
    preview: false,
    openerId: null,
  }));

  return normalize({
    tabs,
    groups:
      groupFrom === undefined ? [] : [{ id: "G", name: "Specs", color: "clay", collapsed: false }],
    activeTabId: "t0",
  });
}

function widths(session: Session, stripWidth: number, pill = 100) {
  return layoutTabs({ session, stripWidth, pillWidths: { G: pill } });
}

describe("widen and squeeze", () => {
  it("caps a handful of tabs rather than stretching them across the window", () => {
    const layout = widths(build(3), 1000);
    expect(layout.slots.map((slot) => slot.width)).toEqual([TAB_MAX, TAB_MAX, TAB_MAX]);
    expect(layout.overflow).toBe(false);
  });

  it("squeezes as more tabs open and widens again as they close", () => {
    const many = widths(build(10), 1000).tabWidth;
    const fewer = widths(build(6), 1000).tabWidth;
    expect(many).toBeLessThan(fewer);
    expect(fewer).toBeLessThanOrEqual(TAB_MAX);
  });

  it("fills the available width exactly, with the spare pixels on the left", () => {
    // Rounding each tab independently makes the total drift, and the stray
    // pixel lands on a different tab every time the ResizeObserver fires.
    const layout = widths(build(10), 1000);
    const total =
      layout.slots.reduce((sum, slot) => sum + slot.width, 0) + GAP * (layout.slots.length - 1);

    expect(total).toBe(1000 - PLUS_W - DRAG_RESERVE);

    const sizes = layout.slots.map((slot) => slot.width);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBe(1);
    // Descending: every wide tab precedes every narrow one.
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });

  it("stops shrinking at the floor and scrolls instead", () => {
    const layout = widths(build(20), 500);
    expect(layout.overflow).toBe(true);
    expect(layout.slots.every((slot) => slot.width === TAB_MIN)).toBe(true);
    expect(layout.trackWidth).toBeGreaterThan(500);
  });

  it("always leaves the window a strip to be dragged by", () => {
    // A frameless window with no drag region left is a window you cannot move.
    for (const count of [1, 3, 8, 15]) {
      const layout = widths(build(count), 900);
      if (layout.overflow) continue;
      expect(layout.trackWidth + PLUS_W + DRAG_RESERVE).toBeLessThanOrEqual(900);
    }
  });

  it("lays out nothing when nothing is open", () => {
    const layout = widths(normalize({ tabs: [], groups: [], activeTabId: null }), 900);
    expect(layout.slots).toEqual([]);
    expect(layout.overflow).toBe(false);
  });
});

describe("groups", () => {
  it("gives a group a pill and keeps its tabs inside the band", () => {
    const layout = widths(build(4, 1, 2), 1000);
    expect(layout.slots.map((slot) => slot.kind)).toEqual(["tab", "pill", "tab", "tab", "tab"]);
    expect(layout.slots[1]!.width).toBe(100);
  });

  it("costs only its pill once collapsed", () => {
    const expanded = widths(build(4, 1, 2), 1000);
    const collapsed = widths(setGroupCollapsed(build(4, 1, 2), "G", true), 1000);

    expect(collapsed.slots.map((slot) => slot.key)).toEqual(["t0", "G", "t3"]);
    // Two tabs stopped competing for width, so the survivors got wider (or hit
    // the cap, which is what happens here).
    expect(collapsed.tabWidth).toBeGreaterThanOrEqual(expanded.tabWidth);
  });

  it("places slots left to right without overlapping", () => {
    const layout = widths(build(5, 1, 3), 1000);
    for (let index = 1; index < layout.slots.length; index += 1) {
      const previous = layout.slots[index - 1]!;
      const current = layout.slots[index]!;
      expect(current.left).toBeGreaterThanOrEqual(previous.left + previous.width);
    }
  });
});

describe("pill sizing", () => {
  it("clamps to a readable range so one long name cannot eat the bar", () => {
    expect(clampPill(5)).toBe(PILL_MIN);
    expect(clampPill(9000)).toBe(PILL_MAX);
  });

  it("shrinks an unnamed group to its colour dot", () => {
    const unnamed = { id: "G", name: "", color: "clay" as const, collapsed: false };
    expect(pillWidthFor(unnamed, 200)).toBe(PILL_MIN);
  });

  it("reserves room for the label, and for the count when collapsed", () => {
    // Too tight and the pill truncates its own group's name to "Sp…".
    const group = { id: "G", name: "Specs", color: "clay" as const, collapsed: false };
    expect(pillWidthFor(group, 40)).toBe(74);
    expect(pillWidthFor({ ...group, collapsed: true }, 40)).toBe(98);
  });
});
