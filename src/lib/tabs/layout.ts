/**
 * How wide each tab is, and where it sits.
 *
 * Browser behaviour: tabs share the strip evenly, widening as tabs close and
 * squeezing as they open, down to a floor — past which the strip stops
 * shrinking and scrolls instead. Widths are computed here rather than left to
 * flexbox because the drag layer needs exact geometry anyway, and because a
 * computed `width` animates the squeeze for free.
 *
 * Pure, so the whole squeeze/widen/overflow story is testable without a DOM.
 */

import type { Session, TabGroup } from "./model";

/** Below this a tab shows an icon and an ellipsis and nothing useful, so the
 *  strip scrolls rather than shrinking further. */
export const TAB_MIN = 76;
/** Chrome's number. Wider than this and a handful of tabs look like a toolbar. */
export const TAB_MAX = 208;
/** Drawn as internal padding, never as margin: a margin between two `no-drag`
 *  tabs is a live window-drag region, and a click landing in it would start
 *  moving the window instead of selecting a tab. */
export const GAP = 2;
export const GROUP_PAD = 4;
export const PLUS_W = 28;
export const OVERFLOW_W = 26;
/** Untouched `drag-region` kept at the end of the strip so the window can
 *  always be moved and double-click-maximized. Survives overflow — on a
 *  frameless window there is no other way to grab the titlebar. */
export const DRAG_RESERVE = 56;
/** Cap for a measured group pill, so one long group name cannot eat the bar. */
export const PILL_MAX = 148;
/** An unnamed group is its colour dot and the padding around it, nothing more. */
export const PILL_MIN = 26;
/** Horizontal padding, the colour dot, the gap after it, and a little slack —
 *  sized exactly, the label truncates itself on a subpixel rounding. */
const PILL_CHROME = 34;
/** A collapsed group also shows how many tabs it is hiding. */
const PILL_COUNT_W = 24;

export interface Slot {
  kind: "tab" | "pill";
  /** Tab id for a tab, group id for a pill. */
  key: string;
  groupId: string | null;
  left: number;
  width: number;
}

export interface Layout {
  slots: Slot[];
  /** True once tabs have hit `TAB_MIN` and the strip has to scroll. */
  overflow: boolean;
  /** Natural width of the content. Equals the available width when not
   *  overflowing, and exceeds it when it does. */
  trackWidth: number;
  /** Uniform elastic tab width before the remainder pass. */
  tabWidth: number;
}

export interface LayoutInput {
  session: Session;
  stripWidth: number;
  /** Measured pill widths by group id; anything missing falls back to the
   *  minimum. Measurement belongs to the component — this file stays pure. */
  pillWidths: Record<string, number>;
}

/** What the strip is made of, before any width is decided: one pill per group
 *  plus every tab that is actually drawn. */
function sequence(session: Session): Array<{
  kind: "tab" | "pill";
  key: string;
  groupId: string | null;
}> {
  const collapsed = new Set(
    session.groups.filter((group) => group.collapsed).map((group) => group.id),
  );
  const emitted = new Set<string>();
  const out: Array<{ kind: "tab" | "pill"; key: string; groupId: string | null }> =
    [];

  for (const tab of session.tabs) {
    if (tab.groupId !== null && !emitted.has(tab.groupId)) {
      emitted.add(tab.groupId);
      out.push({ kind: "pill", key: tab.groupId, groupId: tab.groupId });
    }
    // A collapsed group is represented by its pill alone.
    if (tab.groupId !== null && collapsed.has(tab.groupId)) continue;
    out.push({ kind: "tab", key: tab.id, groupId: tab.groupId });
  }

  return out;
}

export function clampPill(width: number): number {
  return Math.min(Math.max(Math.round(width), PILL_MIN), PILL_MAX);
}

export function layoutTabs({
  session,
  stripWidth,
  pillWidths,
}: LayoutInput): Layout {
  const elements = sequence(session);
  const groupCount = elements.filter((e) => e.kind === "pill").length;
  const elastic = elements.filter((e) => e.kind === "tab").length;

  const pillTotal = elements
    .filter((element) => element.kind === "pill")
    .reduce((sum, element) => sum + clampPill(pillWidths[element.key] ?? PILL_MIN), 0);

  // Everything that is not an elastic tab.
  const fixed =
    pillTotal +
    2 * GROUP_PAD * groupCount +
    GAP * Math.max(0, elements.length - 1);

  // Whether the overflow chevron is shown changes the available width, which
  // changes whether we overflow — so decide without it, then confirm with it.
  const overflow =
    overflows(stripWidth, fixed, elastic, false) &&
    overflows(stripWidth, fixed, elastic, true);

  const available = availableFor(stripWidth, overflow);
  const raw = elastic === 0 ? 0 : Math.floor((available - fixed) / elastic);
  const tabWidth = elastic === 0 ? 0 : Math.min(Math.max(raw, TAB_MIN), TAB_MAX);

  // Integer widths with an explicit remainder: rounding each tab on its own
  // makes the total drift, and the stray pixel lands on a different tab every
  // time the ResizeObserver fires, which shimmers while resizing the window.
  const slack = available - fixed - elastic * tabWidth;
  const remainder =
    overflow || tabWidth === TAB_MAX ? 0 : Math.min(Math.max(slack, 0), elastic);

  const slots: Slot[] = [];
  let x = 0;
  let elasticIndex = 0;
  let openGroup: string | null = null;

  elements.forEach((element, index) => {
    if (index > 0) x += GAP;
    // A group band is padded on both sides, so its tabs read as sitting inside
    // the pill's territory rather than merely next to it.
    if (element.kind === "pill") x += GROUP_PAD;
    if (openGroup !== null && element.groupId !== openGroup) x += GROUP_PAD;
    openGroup = element.groupId;

    const width =
      element.kind === "pill"
        ? clampPill(pillWidths[element.key] ?? PILL_MIN)
        : tabWidth + (elasticIndex++ < remainder ? 1 : 0);

    slots.push({ ...element, left: x, width });
    x += width;
  });

  if (openGroup !== null) x += GROUP_PAD;

  return { slots, overflow, trackWidth: x, tabWidth };
}

function availableFor(stripWidth: number, overflow: boolean): number {
  return Math.max(
    0,
    stripWidth - PLUS_W - DRAG_RESERVE - (overflow ? OVERFLOW_W : 0),
  );
}

function overflows(
  stripWidth: number,
  fixed: number,
  elastic: number,
  withChevron: boolean,
): boolean {
  return elastic * TAB_MIN + fixed > availableFor(stripWidth, withChevron);
}

/** The width a pill needs for its contents, given a measured text width. An
 *  unnamed group collapses to the colour dot alone. */
export function pillWidthFor(group: TabGroup, textWidth: number): number {
  const count = group.collapsed ? PILL_COUNT_W : 0;
  if (group.name === "") return clampPill(PILL_MIN + count);
  return clampPill(PILL_CHROME + textWidth + count);
}
