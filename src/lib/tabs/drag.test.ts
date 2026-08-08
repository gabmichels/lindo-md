import { describe, expect, it } from "vitest";

import {
  DRAG_THRESHOLD,
  IDLE,
  commitOf,
  displacementOf,
  isDragging,
  isOverSplit,
  reduce,
  type DragSnapshot,
  type DragState,
} from "./drag";
import { GAP, layoutTabs } from "./layout";
import { moveTab, normalize, type Session, type Tab } from "./model";

/** Four 100px tabs, optionally with a group, laid out for real by `layoutTabs`
 *  so the drag maths is exercised against the geometry it will actually see. */
function scene(group?: [number, number]): Session {
  const names = ["a", "b", "c", "d"];
  const [from, to] = group ?? [-1, -1];

  return normalize({
    tabs: names.map<Tab>((name, index) => ({
      id: name,
      path: `/${name}.md`,
      groupId: index >= from && index <= to ? "G" : null,
      preview: false,
      openerId: null,
    })),
    groups: from < 0 ? [] : [{ id: "G", name: "Specs", color: "clay" as const, collapsed: false }],
    activeTabId: "a",
    comparePath: null,
  });
}

function snapshotFor(
  session: Session,
  subjectId: string,
  splitZone: DragSnapshot["splitZone"] = null,
): DragSnapshot {
  const { slots, trackWidth } = layoutTabs({
    session,
    stripWidth: 900,
    pillWidths: { G: 60 },
  });

  const slotIndex = slots.findIndex((slot) => slot.key === subjectId);
  return {
    slots,
    order: session.tabs.map((tab) => tab.id),
    groupOf: Object.fromEntries(session.tabs.map((tab) => [tab.id, tab.groupId])),
    subject: { kind: "tab", id: subjectId },
    slotIndex,
    blockLength: 1,
    // Grabbed in the middle of the tab, which is what a real pointer does.
    grabOffset: slots[slotIndex]!.width / 2,
    trackWidth,
    splitZone,
  };
}

function centerOf(snapshot: DragSnapshot, key: string): number {
  const slot = snapshot.slots.find((candidate) => candidate.key === key)!;
  return slot.left + slot.width / 2;
}

function press(snapshot: DragSnapshot, x: number): DragState {
  return reduce(IDLE, { type: "down", pointerId: 1, x, y: 0, snapshot });
}

/** A move along the strip: a reorder. The client position defaults to the
 *  strip's own row, which is outside any split zone. */
function move(state: DragState, x: number, y = 0, client = { x: 0, y: 0 }): DragState {
  return reduce(state, {
    type: "move",
    pointerId: 1,
    x,
    y,
    clientX: client.x,
    clientY: client.y,
    now: 0,
  });
}

describe("press versus drag", () => {
  it("stays a click until the pointer has actually travelled", () => {
    const snapshot = snapshotFor(scene(), "a");
    const state = move(press(snapshot, 50), 50 + DRAG_THRESHOLD - 1);
    expect(isDragging(state)).toBe(false);
    expect(commitOf(state)).toBe(null);
  });

  it("becomes a drag past the threshold", () => {
    const snapshot = snapshotFor(scene(), "a");
    expect(isDragging(move(press(snapshot, 50), 50 + DRAG_THRESHOLD))).toBe(true);
  });

  it("ignores a second pointer entirely", () => {
    const snapshot = snapshotFor(scene(), "a");
    const pressed = press(snapshot, 50);
    const other = reduce(pressed, {
      type: "move",
      pointerId: 2,
      x: 900,
      y: 0,
      clientX: 0,
      clientY: 0,
      now: 0,
    });
    expect(other).toBe(pressed);
  });
});

/** Applies what a release would do, so tests assert the order the reader ends
 *  up with rather than a raw seam. Several seams can mean the same move — the
 *  tab is removed before it is inserted — so the order is the real contract. */
function dropped(session: Session, subjectId: string, state: DragState): string {
  const target = commitOf(state);
  if (!target) throw new Error("the gesture never became a drag");
  return moveTab(session, subjectId, target.seam, target.intent)
    .tabs.map((tab) => tab.id)
    .join(" ");
}

describe("reordering", () => {
  it("moves the tab past whatever its centre was dragged beyond", () => {
    const session = scene();
    const snapshot = snapshotFor(session, "a");
    const state = move(press(snapshot, centerOf(snapshot, "a")), centerOf(snapshot, "c") + 30);
    expect(dropped(session, "a", state)).toBe("b c a d");
  });

  it("changes nothing when the tab is brought back to where it started", () => {
    const session = scene();
    const snapshot = snapshotFor(session, "b");
    const start = centerOf(snapshot, "b");
    const state = move(move(press(snapshot, start), start + 300), start);
    expect(dropped(session, "b", state)).toBe("a b c d");
  });

  it("drags a tab to the far end", () => {
    const session = scene();
    const snapshot = snapshotFor(session, "a");
    const state = move(press(snapshot, centerOf(snapshot, "a")), 5000);
    expect(dropped(session, "a", state)).toBe("b c d a");
  });
});

describe("group membership at the drop position", () => {
  it("joins the group when dropped between two of its members", () => {
    // `d` dragged into the middle of the run `b c`.
    const session = scene([1, 2]);
    const snapshot = snapshotFor(session, "d");
    const state = move(press(snapshot, centerOf(snapshot, "d")), centerOf(snapshot, "c"));
    expect(commitOf(state)).toMatchObject({ intent: { kind: "join", groupId: "G" } });
    expect(dropped(session, "d", state)).toBe("a b d c");
  });

  it("does not join when dropped at the group's edge", () => {
    // Half in is not in: the seam before the run's first member has an
    // ungrouped neighbour on its left, so it is a boundary, not an interior.
    const session = scene([1, 2]);
    const snapshot = snapshotFor(session, "d");
    const state = move(press(snapshot, centerOf(snapshot, "d")), centerOf(snapshot, "a") + 30);
    expect(commitOf(state)).toMatchObject({ intent: { kind: "none" } });
  });
});

describe("what the reader sees", () => {
  it("slides exactly the neighbour it has been dragged past", () => {
    // The hit test reasons about the layout with the subject removed, so the
    // rendering has to agree slot for slot. Where they disagreed, the tab under
    // the pointer was not the tab the drop acted on — which is what made
    // grouping feel unhittable.
    const snapshot = snapshotFor(scene(), "a");
    const start = centerOf(snapshot, "a");
    const vacated = snapshot.slots[0]!.width + GAP;

    // Still in its own slot: the gap is already where it would land, so
    // nothing has any reason to move.
    const resting = move(press(snapshot, start), start + DRAG_THRESHOLD, 0);
    expect(displacementOf(resting, 1)).toBe(0);

    // Carried past `b`: `b` closes up behind it, and `c` beyond stays put.
    const past = move(resting, centerOf(snapshot, "b"), 0);
    expect(displacementOf(past, 1)).toBe(-vacated);
    expect(displacementOf(past, 2)).toBe(0);
  });

  it("reopens the gap where the tab would land", () => {
    const snapshot = snapshotFor(scene(), "a");
    const state = move(press(snapshot, centerOf(snapshot, "a")), 5000);
    // Dragged to the end: everything has closed up and nothing is pushed right.
    expect(displacementOf(state, 1)).toBeLessThan(0);
    expect(displacementOf(state, 3)).toBeLessThan(0);
  });
});

describe("giving up", () => {
  it("cancels without committing anything", () => {
    const snapshot = snapshotFor(scene(), "a");
    const dragging = move(press(snapshot, centerOf(snapshot, "a")), 500);
    expect(commitOf(reduce(dragging, { type: "cancel" }))).toBe(null);
  });

  it("aborts when the dragged tab is closed underneath it", () => {
    const snapshot = snapshotFor(scene(), "a");
    const dragging = move(press(snapshot, centerOf(snapshot, "a")), 500);
    const invalidated = reduce(dragging, { type: "invalidate", removedIds: ["a"] });
    expect(invalidated).toBe(IDLE);
  });

  it("survives another tab being closed underneath it", () => {
    // The snapshot is frozen, so nothing about the geometry depended on `d`.
    const snapshot = snapshotFor(scene(), "a");
    const dragging = move(press(snapshot, centerOf(snapshot, "a")), 500);
    expect(reduce(dragging, { type: "invalidate", removedIds: ["d"] })).toBe(dragging);
  });
});

/**
 * Dragging into the canvas's right half, which opens the comparison pane.
 *
 * The zone is in client coordinates and lives well below the strip, which is
 * the whole reason this second outcome is safe where tab-onto-tab grouping was
 * not: there, two different intentions shared a pointer position. Here they are
 * separated by the entire toolbar.
 */
const ZONE = { minX: 600, minY: 100 };

describe("dragging into the split zone", () => {
  it("is not a split while the pointer is still in the strip", () => {
    const snapshot = snapshotFor(scene(), "a", ZONE);
    const state = move(press(snapshot, centerOf(snapshot, "a")), 500, 0, { x: 900, y: 20 });
    expect(isOverSplit(state)).toBe(false);
    expect(commitOf(state)).not.toBe(null);
  });

  it("is not a split in the left half of the canvas", () => {
    const snapshot = snapshotFor(scene(), "a", ZONE);
    const state = move(press(snapshot, centerOf(snapshot, "a")), 500, 0, { x: 400, y: 400 });
    expect(isOverSplit(state)).toBe(false);
  });

  it("splits in the right half, below the chrome", () => {
    const snapshot = snapshotFor(scene(), "a", ZONE);
    const state = move(press(snapshot, centerOf(snapshot, "a")), 500, 0, { x: 900, y: 400 });
    expect(isOverSplit(state)).toBe(true);
  });

  it("refuses to also reorder, so one drop cannot do two things", () => {
    const snapshot = snapshotFor(scene(), "a", ZONE);
    const state = move(press(snapshot, centerOf(snapshot, "a")), 500, 0, { x: 900, y: 400 });
    expect(commitOf(state)).toBe(null);
  });

  it("goes back to the reorder it interrupted when the pointer leaves", () => {
    // Not to a seam of zero: the reader was mid-drag, and coming back out of
    // the zone has to return them to where the tab was going.
    const snapshot = snapshotFor(scene(), "a", ZONE);
    const along = move(press(snapshot, centerOf(snapshot, "a")), 500);
    const inside = move(along, 500, 0, { x: 900, y: 400 });
    const back = move(inside, 500, 0, { x: 900, y: 20 });
    expect(isOverSplit(back)).toBe(false);
    expect(commitOf(back)).toEqual(commitOf(along));
  });

  it("never splits when there is no zone, which is how a group is refused", () => {
    // `TabStrip` passes null for a group: a pane holds one document, so there
    // is nothing for a group to become.
    const snapshot = snapshotFor(scene(), "a");
    const state = move(press(snapshot, centerOf(snapshot, "a")), 500, 0, { x: 900, y: 400 });
    expect(isOverSplit(state)).toBe(false);
  });

  it("is never a split before the press has become a drag", () => {
    const snapshot = snapshotFor(scene(), "a", ZONE);
    expect(isOverSplit(press(snapshot, 50))).toBe(false);
  });
});
