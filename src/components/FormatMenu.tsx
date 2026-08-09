import * as ContextMenu from "@radix-ui/react-context-menu";

import {
  ContextItem,
  ContextSeparator,
  ITEM_CLASS,
  MENU_CLASS,
  Shortcut,
} from "@/components/ui/menu";
import type { FormatCommand } from "@/lib/edit/format";
import { MARK_SLOTS, type MarkSlot } from "@/lib/theme/apply";

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
  /**
   * Marks the selection. Absent where annotating is not offered at all — the
   * comparison pane, and any document with no source map to anchor against.
   *
   * Separate from `canFormat` on purpose, and the difference is the point: a
   * selection spanning two paragraphs cannot be *formatted*, because wrapping the
   * markup between them rewrites the document, but it can perfectly well be
   * *marked*. See `annotationRange` beside `selectionRange`.
   */
  onHighlight?: (slot: MarkSlot) => void;
  canHighlight?: boolean;
  /** True when the right-click landed on an existing mark. */
  canRemoveHighlight?: boolean;
  onRemoveHighlight?: () => void;
}

/** Nouns, like every other row here. The slot names are lowercase in the
 *  database because they are identifiers, not labels. */
const SLOT_LABELS: Record<MarkSlot, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  purple: "Purple",
};

export function FormatMenu({
  children,
  canFormat,
  onFormat,
  onCopy,
  onEditSource,
  onHighlight,
  canHighlight = false,
  canRemoveHighlight = false,
  onRemoveHighlight,
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

          {onHighlight && (
            <>
              <ContextSeparator />

              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={ITEM_CLASS} disabled={!canHighlight}>
                  Highlight
                  <span className="ml-auto pl-4 text-ui-text-faint">›</span>
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className={MENU_CLASS}>
                    {MARK_SLOTS.map((slot) => (
                      <ContextItem
                        key={slot}
                        onSelect={() => {
                          onHighlight(slot);
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="mr-2 inline-block size-3 rounded-ui-sm"
                          // The swatch is the tool's copy of the palette, never
                          // the paper's — see `--ui-mark-*` in styles.css.
                          style={{ background: `var(--ui-mark-${slot})` }}
                        />
                        {SLOT_LABELS[slot]}
                      </ContextItem>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>

              {/* Only when there is one to remove. A permanently greyed row
                  teaches nothing; an absent one asks no question. */}
              {canRemoveHighlight && onRemoveHighlight && (
                <ContextItem onSelect={onRemoveHighlight}>Remove highlight</ContextItem>
              )}
            </>
          )}

          <ContextSeparator />

          <ContextItem onSelect={onCopy}>Copy</ContextItem>
          {onEditSource && <ContextItem onSelect={onEditSource}>Edit as Markdown…</ContextItem>}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
