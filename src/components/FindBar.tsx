import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { FindState } from "@/hooks/useFind";
import { cn } from "@/lib/utils";

/**
 * The find overlay. Floats over the document rather than pushing it down —
 * shifting the text the reader is searching would move the match they are
 * looking for.
 */

interface FindBarProps {
  find: FindState;
  onClose: () => void;
}

export function FindBar({ find, onClose }: FindBarProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.select();
  }, []);

  return (
    // The Escape/Enter handling belongs to the whole widget, not to the input: the
    // keys have to work wherever focus sits inside the bar. `search` is a landmark
    // role, which is what the rule objects to.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- widget-level key handling
    <div
      role="search"
      className={cn(
        "absolute top-2 right-4 z-30 flex items-center gap-1 rounded-ui-lg",
        "bg-ui-plane-2 px-1.5 py-1 shadow-xl",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          if (event.shiftKey) find.previous();
          else find.next();
        }
      }}
    >
      <input
        ref={input}
        type="search"
        value={find.query}
        placeholder="Find in document"
        aria-label="Find in document"
        onChange={(event) => {
          find.setQuery(event.target.value);
        }}
        className={cn(
          "w-52 bg-transparent px-1.5 py-1 text-[12.5px] text-ui-text-strong",
          "placeholder:text-ui-text-faint focus:outline-none",
        )}
      />

      <span className="min-w-[4.5ch] text-center text-[11.5px] text-ui-text-faint tabular-nums">
        {find.query === ""
          ? ""
          : find.matchCount === 0
            ? "0"
            : `${find.activeIndex + 1}/${find.matchCount}`}
      </span>

      <FindButton
        label="Previous match"
        icon={ChevronUp}
        disabled={find.matchCount === 0}
        onClick={find.previous}
      />
      <FindButton
        label="Next match"
        icon={ChevronDown}
        disabled={find.matchCount === 0}
        onClick={find.next}
      />
      <FindButton label="Close find" icon={X} onClick={onClose} />
    </div>
  );
}

function FindButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof X;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-6 place-items-center rounded-ui-sm text-ui-text-muted",
        "transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-1 hover:text-ui-text-strong",
        "disabled:pointer-events-none disabled:opacity-30",
      )}
    >
      <Icon size={13} strokeWidth={1.6} aria-hidden />
    </button>
  );
}
