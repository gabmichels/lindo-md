import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

/**
 * Drag-to-resize for a fixed-width chrome column.
 *
 * The width lives in a `--ui-*` custom property on a surface element, and every
 * consumer — the panel itself, the titlebar's traffic-light shim — reads it from
 * there. That indirection is the point: a drag writes the property straight onto
 * the DOM node and React is not involved until the pointer comes up.
 *
 * The alternative, holding the width in state, re-renders the whole app on every
 * pointer move — and the app contains a fully rendered document with highlighted
 * code and Mermaid diagrams in it. The drag was visibly behind the cursor.
 *
 * Committing on release rather than continuously also keeps one drag as one
 * config write instead of ~200 coalesced by the debounce.
 */

/** Coarse keyboard step: four units of the 4px grid. Shift drops to one. */
const STEP = 16;
const FINE_STEP = 4;

/**
 * Everything that ends a drag *through an event*.
 *
 * `lostpointercapture` covers a capture the browser takes back — but not, it
 * turns out, the case that matters most here. See `endedByUnmount` below.
 */
const END_EVENTS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

interface Resizable {
  /** The property the panel's width is drawn from, e.g. `--ui-rail-w`. */
  cssVar: string;
  /** Element carrying that property. Written directly during a drag. */
  surface: RefObject<HTMLElement | null>;
  width: number;
  min: number;
  max: number;
  /** The width this panel returns to on a double-click. */
  initial: number;
  /**
   * Which way the panel grows relative to pointer movement: `1` when the panel
   * is to the *left* of the handle, `-1` when it is to the right.
   */
  grow: 1 | -1;
  onCommit: (width: number) => void;
}

export function useResizable(options: Resizable) {
  const { cssVar, surface, width, min, max, initial, grow, onCommit } = options;

  // Read inside the pointer handlers, which outlive the render that installed
  // them: a drag started before a re-render would otherwise commit against a
  // stale starting width.
  const latest = useRef(options);
  latest.current = options;

  /**
   * The in-flight drag's `end`, so unmounting can finish it.
   *
   * Both handles are conditionally rendered — a shortcut can collapse the rail
   * or close the notes panel with the pointer still down — and the obvious
   * remedy for that, listening for `lostpointercapture`, does not work. Chromium
   * removes an element without firing *any* pointer event at it: a probe that
   * captured a pointer and then removed the element saw no `lostpointercapture`,
   * no `pointercancel`, and no `pointerup`, even after the button was released.
   * A detached node simply stops hearing about the pointer it captured.
   *
   * So the unmount itself has to be the signal. Without this the commit never
   * runs: the shell keeps the dragged width in its inline style while config
   * keeps the old one, and React cannot reconcile them, because the style prop's
   * string never changed and its diff is a no-op. The panel holds a width that
   * outlives the gesture and survives until the next resize or a restart.
   */
  const endedByUnmount = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      endedByUnmount.current?.();
    },
    [],
  );

  const draw = useCallback(
    (next: number) => {
      surface.current?.style.setProperty(cssVar, `${next}px`);
    },
    [cssVar, surface],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      // Only the primary button, and never a drag the browser started for us.
      if (event.button !== 0) return;

      const startX = event.clientX;
      const startWidth = latest.current.width;
      const handle = event.currentTarget;
      handle.focus();
      handle.setPointerCapture(event.pointerId);

      // Instead of `preventDefault()` on the pointerdown, which is the reflex
      // here and is wrong. That suppresses the compatibility mouse events, and
      // focus-on-click is a default action of `mousedown` — so the handle never
      // took focus, and the obvious gesture (grab it, then nudge with the arrow
      // keys) did nothing while the key went wherever focus happened to be. The
      // keyboard path exists to serve exactly that gesture. Measured, not
      // reasoned: with the preventDefault in place `document.activeElement` was
      // still `<body>` after a press on the handle.
      //
      // The only thing preventDefault was buying is suppressing the text
      // selection a drag across two panels would paint, and a style says that
      // without costing the focus.
      const selectionWas = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      let current = startWidth;

      const clamp = (value: number) =>
        Math.round(Math.min(latest.current.max, Math.max(latest.current.min, value)));

      const move = (e: globalThis.PointerEvent) => {
        current = clamp(startWidth + (e.clientX - startX) * latest.current.grow);
        draw(current);
      };

      let ended = false;
      const end = () => {
        // `lostpointercapture` can arrive alongside `pointerup`, and the unmount
        // cleanup can arrive after either; committing twice would write the same
        // width twice.
        if (ended) return;
        ended = true;
        endedByUnmount.current = null;
        for (const type of END_EVENTS) handle.removeEventListener(type, end);
        handle.removeEventListener("pointermove", move);
        document.body.style.userSelect = selectionWas;
        // Hand the final width back to React, which now writes the same value
        // onto the same property from config. The two agree, so there is no
        // frame where the panel snaps back to where the drag started.
        latest.current.onCommit(current);
      };

      // On the handle rather than on window: pointer capture routes the events
      // here, and a listener on window would keep firing after a capture loss.
      handle.addEventListener("pointermove", move);
      for (const type of END_EVENTS) handle.addEventListener(type, end);
      endedByUnmount.current = end;
    },
    [draw],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? FINE_STEP : STEP;
      const delta =
        event.key === "ArrowLeft" ? -step * grow : event.key === "ArrowRight" ? step * grow : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = Math.round(Math.min(max, Math.max(min, width + delta)));
      draw(next);
      onCommit(next);
    },
    [draw, grow, max, min, onCommit, width],
  );

  const onDoubleClick = useCallback(() => {
    draw(initial);
    onCommit(initial);
  }, [draw, initial, onCommit]);

  return { onPointerDown, onKeyDown, onDoubleClick };
}
