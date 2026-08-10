import { FileDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * What the window shows while droppable Markdown is held over it.
 *
 * Chrome, not paper: it is the tool saying what will happen, so it sits outside
 * the document canvas and reads `--ui-*` only. It also covers the rail, because
 * the drop is accepted anywhere on the window and an overlay stopping at the
 * canvas edge would imply otherwise.
 *
 * The accent ring is the one place it appears outside the three uses in
 * DESIGN.md, and it is the same idea as the third: this is a focus ring drawn
 * around the whole window.
 */
export function DropOverlay({ active }: { active: boolean }) {
  return (
    <div
      // Never interactive. The drag is owned by the OS, and a pane that ate
      // pointer events would break the drop it exists to advertise.
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 z-[60] flex items-center justify-center",
        "bg-black/45 transition-opacity duration-[var(--ui-dur)] ease-[var(--ui-ease)]",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="absolute inset-3 rounded-ui-lg ring-2 ring-ui-accent ring-inset" />
      <p
        className={cn(
          "flex items-center gap-2 rounded-ui-lg px-4 py-3",
          "bg-ui-plane-2 font-ui text-[13px] text-ui-text-strong shadow-2xl",
        )}
      >
        <FileDown size={15} strokeWidth={1.5} aria-hidden />
        Drop to open
      </p>
    </div>
  );
}
