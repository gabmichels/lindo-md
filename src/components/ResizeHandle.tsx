import type { RefObject } from "react";

import { useResizable } from "@/hooks/useResizable";
import { cn } from "@/lib/utils";

/**
 * The grab strip between a chrome column and the canvas.
 *
 * It occupies no layout width. The seam is already drawn — `canvas-edge` on one
 * side, the notes panel's own edge on the other — and a handle that took a
 * column of its own would put a second line beside the one that is already
 * there. So it is a zero-width flex item with the hit area hung off it, wider
 * than what it draws, because a 1px target is a target nobody hits.
 *
 * The accent on hover, focus and drag: this is a control, and the accent is what
 * marks the thing the pointer or the keyboard is acting on (DESIGN.md).
 */

interface ResizeHandleProps {
  /** Names the panel being resized, for the screen reader: "Sidebar width". */
  label: string;
  cssVar: string;
  surface: RefObject<HTMLElement | null>;
  width: number;
  min: number;
  max: number;
  initial: number;
  grow: 1 | -1;
  onCommit: (width: number) => void;
}

export function ResizeHandle({ label, ...options }: ResizeHandleProps) {
  const { width, min, max } = options;
  const handlers = useResizable(options);

  return (
    <div
      // A separator is focusable and takes arrow keys when it is a resizer, which
      // is exactly what this is — the one W3C role that carries a value.
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a `separator` with aria-valuenow is a window splitter, which the APG requires be focusable
      tabIndex={0}
      title={`${label} — drag, or double-click to reset`}
      {...handlers}
      className={cn(
        // `no-drag`: the strip runs the full height of the window, so its top
        // stretch lies over the titlebar's drag region. Without this, grabbing
        // the handle up there moves the window instead (DESIGN.md rule 6).
        "no-drag group relative z-20 w-0 shrink-0 outline-none",
        // The focus ring is drawn below, as a line down the seam. The global
        // `:focus-visible` outline would draw a 2px box around a zero-width
        // element, which lands as a vertical sliver in the wrong place.
        "focus-visible:outline-none",
      )}
    >
      {/* The hit area: 9px straddling the seam, which is Fitts' law rather than
          generosity — the seam sits between two scrollers and an under-shoot
          lands on a scrollbar. */}
      <div
        className={cn(
          "absolute inset-y-0 -left-[4px] w-[9px] cursor-col-resize",
          // What it draws: nothing at rest, an accent line once it is live. The
          // line is 2px and inset to sit on the seam, not beside it.
          "before:absolute before:inset-y-0 before:left-[3px] before:w-[2px]",
          "before:bg-ui-accent before:opacity-0 before:content-['']",
          "before:transition-opacity before:duration-[var(--ui-dur)] before:ease-[var(--ui-ease)]",
          "group-hover:before:opacity-100 group-focus-visible:before:opacity-100",
          "group-active:before:opacity-100",
        )}
        aria-hidden
      />
    </div>
  );
}
