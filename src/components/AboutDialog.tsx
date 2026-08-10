import * as Dialog from "@radix-ui/react-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const REPOSITORY = "https://github.com/gabmichels/lindo-md";

const SHORTCUTS: [string, string][] = [
  ["Ctrl / ⌘ + K", "Go to a file"],
  ["Ctrl / ⌘ + Shift + P", "Run a command"],
  ["Ctrl / ⌘ + O", "Open a file"],
  ["Ctrl / ⌘ + Shift + O", "Open a folder"],
  ["Ctrl / ⌘ + T", "Open a file in a new tab"],
  ["Ctrl / ⌘ + W", "Close the tab"],
  ["Ctrl / ⌘ + Shift + T", "Reopen the last closed tab"],
  ["Ctrl / ⌘ + Tab", "Next tab"],
  ["Ctrl / ⌘ + 1…9", "Select a tab"],
  ["Ctrl / ⌘ + Shift + PgUp/PgDn", "Move the tab"],
  ["Ctrl / ⌘ + F", "Find in document"],
  ["Ctrl / ⌘ + \\", "Compare with another file"],
  ["Ctrl / ⌘ + ,", "Settings"],
  ["Ctrl / ⌘ + Shift + ,", "Appearance"],
  ["Ctrl / ⌘ + + or −", "Zoom in / out"],
  ["Ctrl / ⌘ + 0", "Reset zoom"],
  ["Ctrl / ⌘ + E", "Edit as Markdown"],
  ["Ctrl / ⌘ + Shift + E", "Export as HTML"],
  ["Ctrl / ⌘ + P", "Print or save as PDF"],
  ["Ctrl / ⌘ + [ or ]", "Back / forward"],
  ["Ctrl / ⌘ + B / I / `", "Bold / italic / code"],
  ["Ctrl / ⌘ + Z", "Undo"],
  ["Ctrl / ⌘ + Shift + Z", "Redo"],
];

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    // Only available inside a Tauri host; the specimen route runs in a browser.
    getVersion().then(setVersion, () => undefined);
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2",
            "rounded-ui-lg bg-ui-plane-1 p-5 shadow-2xl",
          )}
        >
          <Dialog.Title className="text-[15px] text-ui-text-strong">
            lindo-md {version && <span className="text-ui-text-faint">{version}</span>}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-ui-text-muted">
            A viewer for Markdown and text, with editorial typography and deeply customizable
            themes. MDX shows its components as code rather than running them, and plain text is
            shown exactly as written; both are read-only. Your documents never leave this machine;
            the launch version check is the only request it makes, and Settings &rarr; General turns
            it off.
          </Dialog.Description>

          <h3 className="rail-label mt-5 mb-1">Shortcuts</h3>
          <dl className="text-[12px]">
            {SHORTCUTS.map(([keys, description]) => (
              <div key={keys} className="flex justify-between gap-4 py-0.5">
                <dt className="text-ui-text-muted">{description}</dt>
                <dd className="shrink-0 text-ui-text tabular-nums">{keys}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                openUrl(REPOSITORY).catch((error: unknown) => {
                  console.error("lindo-md: could not open the repository URL", error);
                });
              }}
              className="text-[12px] text-ui-accent hover:underline"
            >
              Source on GitHub
            </button>
            <Dialog.Close
              className={cn(
                "rounded-ui-md bg-ui-plane-2 px-3 py-1.5 text-[12px] text-ui-text",
                "transition-colors duration-[var(--ui-dur)] hover:text-ui-text-strong",
              )}
            >
              Close
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
