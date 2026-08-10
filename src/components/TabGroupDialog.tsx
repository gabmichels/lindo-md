import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

import { GROUP_COLORS, type GroupColor, type TabGroup } from "@/lib/tabs/model";
import { cn } from "@/lib/utils";

/**
 * Naming a tab group, opened the moment one is created by dropping a tab onto
 * another.
 *
 * Dismissing it is a real answer, not a cancellation: the group still exists,
 * it just has no name yet and shows as a bare coloured pill. Undoing the group
 * is the ungroup command, not the Escape key — losing the arrangement you just
 * made because you did not want to name it would be a bad trade.
 */

interface TabGroupDialogProps {
  group: TabGroup | null;
  onOpenChange: (open: boolean) => void;
  onRename: (name: string) => void;
  onRecolor: (color: GroupColor) => void;
}

export function TabGroupDialog({ group, onOpenChange, onRename, onRecolor }: TabGroupDialogProps) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (group) setName(group.name);
  }, [group]);

  return (
    <Dialog.Root open={group !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[320px] -translate-x-1/2 -translate-y-1/2",
            "rounded-ui-lg bg-ui-plane-1 p-5 shadow-2xl",
          )}
          onOpenAutoFocus={(event) => {
            // Focus the field, not the first button: the reader is here to type
            // a name, and it is the only reason the dialog opened.
            event.preventDefault();
            const input =
              event.target instanceof HTMLElement ? event.target.querySelector("input") : null;
            input?.focus();
            input?.select();
          }}
        >
          <Dialog.Title className="text-[15px] text-ui-text-strong">Name this group</Dialog.Title>
          <Dialog.Description className="mt-1 text-[12px] text-ui-text-muted">
            Leave it empty for a colour with no label.
          </Dialog.Description>

          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              onRename(name);
              onOpenChange(false);
            }}
          >
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              aria-label="Group name"
              placeholder="Specs, drafts, chapter two…"
              maxLength={60}
              className={cn(
                "w-full rounded-ui-md bg-ui-plane-2 px-2.5 py-1.5 text-[13px]",
                "text-ui-text placeholder:text-ui-text-faint",
              )}
            />

            <div className="mt-4">
              <p className="rail-label mb-2">Colour</p>
              <div className="flex flex-wrap gap-1.5">
                {GROUP_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    aria-pressed={group?.color === color}
                    title={color}
                    onClick={() => {
                      onRecolor(color);
                    }}
                    className={cn(
                      "size-6 rounded-full transition-[box-shadow] duration-[var(--ui-dur)]",
                      group?.color === color &&
                        "ring-2 ring-ui-text-strong ring-offset-2 ring-offset-ui-plane-1",
                    )}
                    style={{ background: `var(--ui-group-${color})` }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close
                className={cn(
                  "rounded-ui-md px-3 py-1.5 text-[12.5px] text-ui-text-muted",
                  "transition-colors duration-[var(--ui-dur)] hover:bg-ui-plane-2",
                )}
              >
                Done
              </Dialog.Close>
              <button
                type="submit"
                className={cn(
                  "rounded-ui-md bg-ui-accent px-3 py-1.5 text-[12.5px] font-medium",
                  // Not `black`. That was right while the accent was a fixed
                  // light amber; a derived accent on a light theme is solved
                  // *downward* to clear the rail, so black on it fell to 2.6:1.
                  "text-ui-accent-ink transition-[filter] duration-[var(--ui-dur)] hover:brightness-110",
                )}
              >
                Save name
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
