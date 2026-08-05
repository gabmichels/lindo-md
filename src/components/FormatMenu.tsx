import * as ContextMenu from "@radix-ui/react-context-menu";

import {
  ContextItem,
  ContextSeparator,
  ITEM_CLASS,
  MENU_CLASS,
  Shortcut,
} from "@/components/ui/menu";
import type { FormatCommand } from "@/lib/edit/format";

/**
 * The formatting menu, on a right-click inside the document.
 *
 * It is chrome that happens to open over the paper, so it reads `--ui-*` and
 * looks like the rail rather than the page — you always know which surface you
 * are looking at (DESIGN.md).
 *
 * Every command toggles, which is why the labels are nouns rather than "Make
 * bold": the same row both applies and removes.
 */

interface FormatMenuProps {
  children: React.ReactNode;
  /** False when the selection is not something the rendered view can edit — no
   *  selection, or one spanning two blocks, or one inside a code fence. */
  canFormat: boolean;
  onFormat: (command: FormatCommand) => void;
  onCopy: () => void;
  /** Opens the source view at whatever was right-clicked — the escape hatch for
   *  everything the rendered view will not edit. Absent until that view exists;
   *  a menu row that does nothing is worse than one that is not there. */
  onEditSource?: () => void;
}

export function FormatMenu({
  children,
  canFormat,
  onFormat,
  onCopy,
  onEditSource,
}: FormatMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={MENU_CLASS}>
          <ContextItem
            onSelect={() => {
              onFormat("bold");
            }}
            disabled={!canFormat}
          >
            Bold
            <Shortcut>Ctrl+B</Shortcut>
          </ContextItem>
          <ContextItem
            onSelect={() => {
              onFormat("italic");
            }}
            disabled={!canFormat}
          >
            Italic
            <Shortcut>Ctrl+I</Shortcut>
          </ContextItem>
          <ContextItem
            onSelect={() => {
              onFormat("code");
            }}
            disabled={!canFormat}
          >
            Code
            <Shortcut>Ctrl+`</Shortcut>
          </ContextItem>
          <ContextItem
            onSelect={() => {
              onFormat("strikethrough");
            }}
            disabled={!canFormat}
          >
            Strikethrough
          </ContextItem>

          <ContextSeparator />

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={ITEM_CLASS} disabled={!canFormat}>
              Heading
              <span className="ml-auto pl-4 text-ui-text-faint">›</span>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={MENU_CLASS}>
                <ContextItem
                  onSelect={() => {
                    onFormat("heading1");
                  }}
                >
                  Heading 1
                </ContextItem>
                <ContextItem
                  onSelect={() => {
                    onFormat("heading2");
                  }}
                >
                  Heading 2
                </ContextItem>
                <ContextItem
                  onSelect={() => {
                    onFormat("heading3");
                  }}
                >
                  Heading 3
                </ContextItem>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={ITEM_CLASS} disabled={!canFormat}>
              List
              <span className="ml-auto pl-4 text-ui-text-faint">›</span>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={MENU_CLASS}>
                <ContextItem
                  onSelect={() => {
                    onFormat("bullet");
                  }}
                >
                  Bulleted
                </ContextItem>
                <ContextItem
                  onSelect={() => {
                    onFormat("numbered");
                  }}
                >
                  Numbered
                </ContextItem>
                <ContextItem
                  onSelect={() => {
                    onFormat("task");
                  }}
                >
                  Task
                </ContextItem>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextItem
            onSelect={() => {
              onFormat("quote");
            }}
            disabled={!canFormat}
          >
            Quote
          </ContextItem>

          <ContextSeparator />

          <ContextItem onSelect={onCopy}>Copy</ContextItem>
          {onEditSource && <ContextItem onSelect={onEditSource}>Edit as Markdown…</ContextItem>}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
