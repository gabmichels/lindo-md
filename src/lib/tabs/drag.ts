/**
 * Dragging a tab or a group along the strip.
 *
 * Written as a pure `(state, event) => state` reducer with the geometry frozen
 * into a snapshot at grab time, so the whole gesture — including the awkward
 * parts, like when reordering turns into grouping — is testable without a DOM,
 * a pointer, or a clock. The component's only jobs are to take the snapshot,
 * feed events in, and draw what comes out.
 *
 * Three things about this specific environment shaped the design:
 *
 * - **Nothing waits on `transitionend`.** `prefers-reduced-motion` forces every
 *   transition to 0.01ms globally, at which point that event fires unreliably
 *   or coalesces away. The model is committed synchronously on release and the
 *   animation is just the DOM catching up.
 * - **State refers to tabs by id, never by index.** A drag lasts hundreds of
 *   milliseconds, during which a live-reload or another window can change the
 *   session underneath it.
 * - **The snapshot is frozen.** Slot centres do not move while dragging, so the
 *   target never depends on where the displaced tabs have animated to.
 */

import { GAP, GROUP_PAD, type Slot } from "./layout";
import type { MoveIntent } from "./model";

/** How far the pointer must travel before a press becomes a drag. Below this a
 *  press is a click, and a click must not nudge the tab order. */
export const DRAG_THRESHOLD = 4;
/** Deadband on the seam, so a tab parked on a boundary does not oscillate. */
export const HYSTERESIS = 6;

export interface DragSubject {
  kind: "tab" | "group";
  id: string;
}

export interface DragSnapshot {
  /** Laid-out slots, in visual order, frozen at grab time. */
  slots: Slot[];
  /** Every tab id in model order, including ones hidden in a collapsed group. */
  order: string[];
  /** Group membership by tab id, for deciding what a drop position means. */
  groupOf: Record<string, string | null>;
  subject: DragSubject;
  /** Index into `slots` of the subject's first slot. */
  slotIndex: number;
  /** How many slots the subject occupies — 1 for a tab, pill + members for a
   *  group. */
  blockLength: number;
  /** Pointer x minus the subject's left edge, both in track coordinates. */
  grabOffset: number;
  trackWidth: number;
}

/** What releasing right now would do. Dragging only ever reorders: making a
 *  group is a menu command, not a gesture. Along the strip, lifting a tab lets
 *  its right neighbour slide into the slot just vacated, so "hovering the tab
 *  to my right" and "having not moved at all" are the same pointer position —
 *  an overlap gesture cannot be told apart from an ordinary drag, which is why
 *  Chrome has no tab-onto-tab grouping either. Dragging a tab *into* an
 *  existing group's run still joins it; that is this same reorder, and the
 *  `intent` is what carries it. */
export interface DropTarget {
  seam: number;
  intent: MoveIntent;
}

/** The gesture in flight. Narrowed out of `DragState` because the geometry
 *  only makes sense once a drag has actually begun. */
export type Dragging = {
  kind: "dragging";
  pointerId: number;
  snapshot: DragSnapshot;
  /** Subject's left edge in track coordinates. */
  x: number;
  target: DropTarget;
  /** Where the subject would be inserted among the remaining slots. Held here
   *  rather than derived twice: the hit test and the animation must agree about
   *  where the gap is, or the tab under the pointer is not the tab the reader
   *  sees under the pointer. */
  position: number;
};

export type DragState =
  | { kind: "idle" }
  | {
      kind: "pressed";
      pointerId: number;
      originX: number;
      originY: number;
      snapshot: DragSnapshot;
    }
  | Dragging;

export type DragEvent =
  | { type: "down"; pointerId: number; x: number; y: number; snapshot: DragSnapshot }
  | { type: "move"; pointerId: number; x: number; y: number; now: number }
  | { type: "up"; pointerId: number }
  | { type: "cancel" }
  /** The session changed underneath the drag. */
  | { type: "invalidate"; removedIds: string[] };

export const IDLE: DragState = { kind: "idle" };

export function reduce(state: DragState, event: DragEvent): DragState {
  switch (event.type) {
    case "down":
      return {
        kind: "pressed",
        pointerId: event.pointerId,
        originX: event.x,
        originY: event.y,
        snapshot: event.snapshot,
      };

    case "cancel":
      return IDLE;

    case "invalidate": {
      if (state.kind === "idle") return state;
      // Only the subject disappearing is fatal: the snapshot is frozen, so a
      // change to any other tab cannot invalidate the geometry mid-gesture.
      const gone = event.removedIds.includes(state.snapshot.subject.id);
      return gone ? IDLE : state;
    }

    case "up":
      // A different pointer's release is not ours to act on.
      if (state.kind === "idle" || state.pointerId !== event.pointerId) return state;
      return IDLE;

    case "move": {
      if (state.kind === "idle" || state.pointerId !== event.pointerId) return state;

      if (state.kind === "pressed") {
        const far =
          Math.abs(event.x - state.originX) >= DRAG_THRESHOLD ||
          Math.abs(event.y - state.originY) >= DRAG_THRESHOLD * 2.5;
        if (!far) return state;

        const started: Dragging = {
          kind: "dragging",
          pointerId: state.pointerId,
          snapshot: state.snapshot,
          x: 0,
          target: { seam: 0, intent: { kind: "keep" } },
          position: 0,
        };
        return advance(started, event.x);
      }

      return advance(state, event.x);
    }
  }
}

/** What the model should be told when the pointer is released. `null` when the
 *  gesture was a click, was cancelled, or would change nothing. */
export function commitOf(state: DragState): DropTarget | null {
  return state.kind === "dragging" ? state.target : null;
}

export function isDragging(state: DragState): boolean {
  return state.kind === "dragging";
}

/**
 * Where a slot has been pushed to by the drag, for the component to draw.
 *
 * The subject tracks the pointer exactly. Every other slot goes to the position
 * it holds in the layout the hit test is reasoning about: gap closed behind the
 * lifted tab, and reopened wherever it would land. Anything less and the tab the
 * reader is aiming at is not the tab the drop would act on.
 */
export function displacementOf(state: DragState, index: number): number {
  if (state.kind !== "dragging") return 0;
  const { snapshot } = state;

  const first = snapshot.slotIndex;
  const after = first + snapshot.blockLength;
  if (index >= first && index < after) {
    return state.x - snapshot.slots[first]!.left;
  }

  const others = otherSlots(snapshot);
  const among = index < first ? index : index - snapshot.blockLength;
  const slot = others[among];
  if (!slot) return 0;

  const opening = among >= state.position ? blockWidth(snapshot) + GAP : 0;

  return slot.left + opening - snapshot.slots[index]!.left;
}

function blockWidth(snapshot: DragSnapshot): number {
  const first = snapshot.slots[snapshot.slotIndex]!;
  const last = snapshot.slots[snapshot.slotIndex + snapshot.blockLength - 1]!;
  const pad = snapshot.subject.kind === "group" ? 2 * GROUP_PAD : 0;
  return last.left + last.width - first.left + pad;
}

function advance(state: Dragging, pointerX: number): Dragging {
  const { snapshot } = state;
  const others = otherSlots(snapshot);
  const block = blockWidth(snapshot);

  const x = clamp(
    pointerX - snapshot.grabOffset,
    0,
    Math.max(0, snapshot.trackWidth - block),
  );

  const previous = positionOfSeam(snapshot, others, state.target.seam);
  const position = positionFor(restingPlaces(others), x, previous);

  return {
    ...state,
    x,
    position,
    target: {
      seam: seamAt(snapshot, others, position),
      intent: intentAt(snapshot, others, position),
    },
  };
}

function restingPlaces(others: Slot[]): number[] {
  const stops: number[] = [];
  let x = 0;
  for (const slot of others) {
    stops.push(x);
    x += slot.width + GAP;
  }
  stops.push(Math.max(0, x - GAP));
  return stops;
}

/** The slots that are not the subject, moved to where the drag has pushed
 *  them — which is where the reader sees them, and so where a drop is aimed. */
function otherSlots(snapshot: DragSnapshot): Slot[] {
  const vacated = blockWidth(snapshot) + GAP;
  const after = snapshot.slotIndex + snapshot.blockLength;

  const out: Slot[] = [];
  snapshot.slots.forEach((slot, index) => {
    if (index >= snapshot.slotIndex && index < after) return;
    out.push(index >= after ? { ...slot, left: slot.left - vacated } : slot);
  });
  return out;
}

/** The insertion position whose resting place the subject is closest to. */
function positionFor(stops: number[], x: number, previous: number): number {
  let best = 0;
  let bestDistance = Infinity;
  stops.forEach((stop, position) => {
    const distance = Math.abs(stop - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = position;
    }
  });

  // Hold the previous answer while the two are near enough to tie, so a tab
  // parked on a boundary does not oscillate at the frame rate.
  if (previous >= 0 && previous < stops.length) {
    const held = Math.abs(stops[previous]! - x);
    if (held - bestDistance < HYSTERESIS) return previous;
  }
  return best;
}

/** Maps a position among the remaining slots to a seam in the model's order. */
function seamAt(snapshot: DragSnapshot, others: Slot[], position: number): number {
  const slot = others[position];
  if (!slot) return snapshot.order.length;

  if (slot.kind === "tab") return snapshot.order.indexOf(slot.key);

  // A pill stands for its whole group, including a collapsed one whose members
  // are not drawn, so the seam is that group's first member.
  const first = snapshot.order.findIndex(
    (id) => snapshot.groupOf[id] === slot.key,
  );
  return first < 0 ? snapshot.order.length : first;
}

function positionOfSeam(
  snapshot: DragSnapshot,
  others: Slot[],
  seam: number,
): number {
  for (let position = 0; position <= others.length; position += 1) {
    if (seamAt(snapshot, others, position) === seam) return position;
  }
  return -1;
}

/**
 * What a drop at this position means for group membership.
 *
 * A seam is inside a group exactly when the tabs on both sides of it belong to
 * that group — so this is a local question about two neighbours, not a search.
 */
function intentAt(
  snapshot: DragSnapshot,
  others: Slot[],
  position: number,
): MoveIntent {
  const before = lastTabBefore(others, position);
  const after = firstTabAfter(others, position);

  const left = (before ? snapshot.groupOf[before.key] : null) ?? null;
  const right = (after ? snapshot.groupOf[after.key] : null) ?? null;

  if (left !== null && left === right) return { kind: "join", groupId: left };
  return { kind: "none" };
}

function lastTabBefore(others: Slot[], position: number): Slot | undefined {
  const slot = others[position - 1];
  return slot?.kind === "tab" ? slot : undefined;
}

function firstTabAfter(others: Slot[], position: number): Slot | undefined {
  const slot = others[position];
  return slot?.kind === "tab" ? slot : undefined;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
