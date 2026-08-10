import { X } from "lucide-react";

import { DocumentView } from "@/components/DocumentView";
import { ReadOnlyBadge } from "@/components/ReadOnlyBadge";
import type { TabRuntime } from "@/hooks/useTabDocuments";
import type { Theme } from "@/lib/theme/schema";
import { basename, cn, dirname } from "@/lib/utils";

/**
 * A second document beside the deck, for reading two files at once.
 *
 * **It is deliberately not a second deck of tabs**, and that is the whole
 * reason this is a small component rather than a pane tree. A split view in an
 * editor pairs source with preview; lindo-md renders, so the only thing a
 * second pane is *for* is comparison — one file, held still, beside the one you
 * are working in. Giving it tabs, groups, drag-between-panes and a per-pane
 * active tab would mean rebuilding `lib/tabs/` around a tree, for a feature
 * whose job is to hold one document.
 *
 * So it holds a path (`Session.comparePath`), not a tab, and it is read-only.
 * Read-only is not a limitation being worked around: two live editable views of
 * one file would mean two undo stacks over one set of bytes, and the file is
 * still editable in its own tab whenever it has one.
 *
 * **It comes in two pieces, and that is the layout's doing rather than a taste
 * for small components.** The pane's name, its read-only badge and its close
 * button live in `CompareBar`, which the canvas draws *in the toolbar row*
 * beside the deck's own toolbar — not stacked above this pane's document. A
 * header of its own would push this document down by its height, and then the
 * two files would sit at different offsets: headings off by a row, the blocked-
 * images notice at two heights, nothing to line up against. A comparison view
 * that cannot be compared line for line has given up the one thing it is for.
 */

/** Shared by the two halves, since they are one control split across two rows. */
interface CompareChrome {
  path: string;
  /** Marks this pane as the one the outline, the find bar and the paging keys
   *  should act on. Raised on focus and on pointer-down, because a reader
   *  arrives at a pane by clicking it as often as by tabbing to it. */
  onFocus: () => void;
  focused: boolean;
}

export function CompareBar({
  path,
  onClose,
  onFocus,
  focused,
}: CompareChrome & { onClose: () => void }) {
  return (
    <div
      className={cn(
        // Exactly the toolbar's height, because it *is* the toolbar row — the
        // two documents below start at the same y only for as long as this is
        // true.
        "compare-edge flex h-[var(--ui-toolbar-h)] min-w-0 flex-1 items-center gap-2 px-2",
        "text-[12.5px]",
        // Which pane the keyboard is talking to has to be visible, or Ctrl+F
        // and Page Down look like they are picking a pane at random. An inset
        // underline rather than a ring around the pane, which would compete
        // with the ring drawn around a window holding a droppable file.
        focused && "shadow-[inset_0_-2px_0_0_var(--ui-accent)]",
      )}
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5" title={path}>
        <span className="truncate text-ui-text-faint">{dirname(path)}</span>
        <span className="text-ui-text-faint">/</span>
        <span className="truncate text-ui-text">{basename(path)}</span>
      </span>

      <ReadOnlyBadge reason="The comparison pane shows a document without editing it. Open the file in a tab to change it." />

      <button
        type="button"
        aria-label="Close the comparison pane"
        title="Close the comparison pane"
        onClick={onClose}
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-ui-sm",
          "text-ui-text-muted transition-colors duration-[var(--ui-dur)]",
          "hover:bg-ui-plane-1 hover:text-ui-text-strong",
        )}
      >
        <X size={15} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}

interface ComparePaneProps extends CompareChrome {
  runtime: TabRuntime | undefined;
  theme: Theme;
  blockRemoteImages: boolean;
  onScrollerReady: (element: HTMLElement | null) => void;
  onScrollChange: (scrollTop: number) => void;
  onAnchorConsumed: () => void;
  /** A link followed here opens in the deck, not in this pane — see `App`. */
  onOpenDocument: (path: string, fragment: string) => void;
}

export function ComparePane({
  path,
  runtime,
  theme,
  blockRemoteImages,
  onScrollerReady,
  onScrollChange,
  onAnchorConsumed,
  onOpenDocument,
  onFocus,
  focused,
}: ComparePaneProps) {
  const document = runtime?.document ?? null;

  return (
    <div
      className={cn(
        // `compare-edge` continues the seam `CompareBar` starts in the row
        // above, so the two panes are divided by one unbroken line rather than
        // by two that have to be kept in step.
        "compare-edge relative min-w-0 flex-1 bg-doc-bg",
        // Printing renders the DOM, so without this an open pane would put both
        // documents in one PDF. The focused pane is the one being printed.
        !focused && "no-print",
      )}
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
      aria-label={`Comparison pane, ${basename(path)}`}
    >
      {runtime?.error ? (
        <Notice text={runtime.error} />
      ) : document ? (
        <DocumentView
          document={document}
          theme={theme}
          blockRemoteImages={blockRemoteImages}
          readOnly
          pendingAnchor={runtime?.pendingAnchor ?? null}
          onAnchorConsumed={onAnchorConsumed}
          onOpenDocument={onOpenDocument}
          onScrollerReady={onScrollerReady}
          restoreScrollTop={runtime?.scrollTop}
          onScrollChange={onScrollChange}
          // The affordances are off via `readOnly`; this is the other half of
          // the same decision. AGENTS.md is blunt about it — a document that is
          // read-only only in React is not read-only — so the pane refuses the
          // write itself rather than trusting that nothing will ask.
          onSave={() => Promise.resolve(false)}
          sourceMode={false}
          onToggleSource={() => undefined}
        />
      ) : (
        <Notice text={`Opening ${basename(path)}…`} />
      )}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="grid h-full place-items-center p-8 text-center font-doc text-doc-text-muted">
      {text}
    </p>
  );
}
