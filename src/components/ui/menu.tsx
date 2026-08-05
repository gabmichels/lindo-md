import * as ContextMenu from "@radix-ui/react-context-menu";

import { cn } from "@/lib/utils";

/**
 * The menu surface, shared by the tab strip and the document's formatting menu.
 *
 * Radix supplies the behaviour — focus, dismissal, ARIA, keyboard traversal —
 * and every visual decision here is ours (DESIGN.md). A menu is chrome even when
 * it opens over the document, so it reads `--ui-*` and never `--doc-*`: it is
 * the tool, not the paper.
 */

export const MENU_CLASS = cn(
  "z-50 min-w-[190px] rounded-ui-lg bg-ui-plane-2 p-1 shadow-2xl",
  "text-[12.5px] text-ui-text",
);

export const ITEM_CLASS = cn(
  "flex cursor-default items-center gap-2 rounded-ui-sm px-2 py-1.5 outline-none",
  "data-[highlighted]:bg-ui-ember-wash data-[highlighted]:text-ui-text-strong",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
);

export function ContextItem({
  children,
  onSelect,
  disabled,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <ContextMenu.Item className={ITEM_CLASS} onSelect={onSelect} disabled={disabled}>
      {children}
    </ContextMenu.Item>
  );
}

export function ContextSeparator() {
  return <ContextMenu.Separator className="my-1 h-px bg-ui-hairline" />;
}

/** The shortcut shown at the right of a row. Tabular numerals and a muted tone,
 *  so a column of them reads as one column rather than as more labels. */
export function Shortcut({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto pl-4 font-mono text-[11px] tabular-nums text-ui-text-faint">
      {children}
    </span>
  );
}
