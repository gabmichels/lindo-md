import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Says that a document cannot be edited here, and why.
 *
 * It sits in the chrome — the toolbar, or the comparison pane's header — rather
 * than on the page, because it describes the *file* or the *view*, not the
 * prose. The paper stays paper.
 *
 * The reason is a string rather than a bool because "read-only" on its own
 * invites the reader to hunt for the switch that turns it off. Sometimes there
 * isn't one, and sometimes there is but it is somewhere else, so the badge says
 * which. `Lock` carries the meaning at a glance for anyone who has seen it
 * before; the word is there for everyone else, and the title attribute carries
 * the reason at length.
 */
export function ReadOnlyBadge({ reason }: { reason: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-ui-sm px-1.5 py-0.5",
        "bg-ui-plane-1 text-[11px] text-ui-text-muted select-none",
      )}
      title={reason}
    >
      <Lock size={11} strokeWidth={1.75} aria-hidden />
      Read-only
    </span>
  );
}
