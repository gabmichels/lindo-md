import { PanelRightClose, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { filterGroups, oneLine, pinCurrent, type DocumentGroup } from "@/lib/annotate/list";
import type { Annotation } from "@/lib/ipc";
import type { MarkSlot } from "@/lib/theme/apply";
import { cn, dragRegion } from "@/lib/utils";

/**
 * Everything the reader has marked, in one column beside the document.
 *
 * The payoff the annotation store was built for: a highlight you cannot find
 * again is a highlight you did not make. The list spans every folder, because
 * the question is "what did I flag about X" and the answer is mostly in files
 * that are not open — which is also why a row shows its stored quote rather than
 * going to the document for one. Nothing here resolves an anchor.
 *
 * **Chrome, not paper.** It sits outside `<main>`, so it reads `--ui-*` and the
 * `--doc-*` tokens are not in scope for it — they are written onto the canvas
 * element and nowhere else, so a `--doc-*` reference here would silently pick up
 * House Light's value whatever theme is on. The one document colour it shows is
 * the mark swatch, handed in as `markColors` and set inline, which is the same
 * arrangement `FormatMenu` uses and for the same reason: a swatch that ignored
 * the theme would be a swatch that lies about the row.
 */

interface NotesPanelProps {
  groups: DocumentGroup[];
  loaded: boolean;
  error: string | null;
  /** The document on screen, whose group is pinned to the top. */
  currentPath: string | null;
  markColors: Record<MarkSlot, string>;
  onClose: () => void;
  /** Show me this mark: the document is opened if it is not already, and the
   *  view scrolls to the words. */
  onReveal: (annotation: Annotation) => void;
  onSetNote: (annotation: Annotation, body: string) => void;
  onRemove: (id: number) => void;
  /** A mark whose note the reader asked to write from the document's context
   *  menu. That row opens its editor; everything else is unaffected. */
  editing?: number | null;
  onEditingHandled?: () => void;
}

export function NotesPanel({
  groups,
  loaded,
  error,
  currentPath,
  markColors,
  onClose,
  onReveal,
  onSetNote,
  onRemove,
  editing = null,
  onEditingHandled,
}: NotesPanelProps) {
  const [query, setQuery] = useState("");

  const shown = useMemo(
    () => pinCurrent(filterGroups(groups, query), currentPath),
    [groups, query, currentPath],
  );

  // A filter left over from earlier would hide the row the reader just asked to
  // write a note on, and they would be looking at an empty panel wondering where
  // their highlight went.
  useEffect(() => {
    if (editing !== null) setQuery("");
  }, [editing]);

  const total = groups.reduce((count, group) => count + group.annotations.length, 0);

  return (
    <aside
      className="flex w-[var(--ui-notes-w)] shrink-0 flex-col bg-ui-base"
      aria-label="Notes and highlights"
    >
      {/* The window has to keep a grab handle on this edge too — DESIGN.md rule
          6. The rail's `TopSpacer` does the same job on the left, and with a
          panel open this column is what the right end of the titlebar becomes. */}
      <div {...dragRegion("h-[var(--ui-titlebar-h)] shrink-0")} aria-hidden />

      <div className="flex h-[var(--ui-toolbar-h)] items-center gap-1 px-[var(--ui-pad)]">
        <h2 className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ui-text-strong">
          Notes
        </h2>
        <button
          type="button"
          aria-label="Close notes"
          title="Close notes"
          onClick={onClose}
          className={cn(
            "no-drag grid size-7 shrink-0 place-items-center rounded-ui-sm",
            "text-ui-text-muted transition-colors duration-[var(--ui-dur)]",
            "hover:bg-ui-plane-1 hover:text-ui-text-strong",
          )}
        >
          <PanelRightClose size={15} strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      {/* Offered only once there is enough to need it — a search box over three
          rows costs more attention than it saves — but never taken away while
          something is typed in it. Deleting rows until the total drops below the
          threshold would otherwise unmount the box with a query still applied,
          leaving a filtered list and nothing to clear it with. */}
      {(total > 6 || query.length > 0) && (
        <div className="px-[var(--ui-pad)] pb-2">
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
              // Every chord in the app is registered on `window`, and the key
              // handler only steps aside for *unmodified* keys typed into a
              // field — so Ctrl+W typed while filtering closes the tab behind
              // this panel. The note editor below guards the same way.
              if (event.ctrlKey || event.metaKey || event.key === "Escape") {
                event.stopPropagation();
              }
            }}
            placeholder="Filter notes"
            aria-label="Filter notes"
            className={cn(
              "no-drag w-full rounded-ui-md bg-ui-plane-1 px-2 py-1",
              "text-[12.5px] text-ui-text placeholder:text-ui-text-muted",
              "outline-none focus-visible:ring-1 focus-visible:ring-ui-ember",
            )}
          />
        </div>
      )}

      {error !== null && (
        <p className="px-[var(--ui-pad)] pb-2 text-[12px] text-ui-ember" role="alert">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--ui-pad)] pb-2">
        {!loaded ? null : shown.length === 0 ? (
          <p className="px-1 py-2 text-[12px] leading-relaxed text-ui-text-muted">
            {total === 0
              ? "Highlight some words and they will be listed here, with any notes you add."
              : "No notes match that."}
          </p>
        ) : (
          shown.map((group) => (
            <Group
              key={group.path}
              group={group}
              current={group.path === currentPath}
              markColors={markColors}
              onReveal={onReveal}
              onSetNote={onSetNote}
              onRemove={onRemove}
              editing={editing}
              onEditingHandled={onEditingHandled}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function Group({
  group,
  current,
  markColors,
  onReveal,
  onSetNote,
  onRemove,
  editing,
  onEditingHandled,
}: {
  group: DocumentGroup;
  current: boolean;
  markColors: Record<MarkSlot, string>;
  onReveal: (annotation: Annotation) => void;
  onSetNote: (annotation: Annotation, body: string) => void;
  onRemove: (id: number) => void;
  editing: number | null;
  onEditingHandled?: () => void;
}) {
  return (
    <section className="mb-3">
      {/* The name, with the full path as the tooltip: a list of twenty
          `index.md` rows is a list of twenty identical rows. */}
      <h3
        title={group.path}
        className={cn(
          "sticky top-0 z-10 truncate bg-ui-base py-1 text-[11px] font-medium uppercase tracking-wide",
          current ? "text-ui-text-strong" : "text-ui-text-muted",
        )}
      >
        {group.name}
      </h3>
      <ul>
        {group.annotations.map((annotation) => (
          <Row
            key={annotation.id}
            annotation={annotation}
            color={markColors[annotation.color as MarkSlot]}
            onReveal={onReveal}
            onSetNote={onSetNote}
            onRemove={onRemove}
            editing={editing === annotation.id}
            onEditingHandled={onEditingHandled}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  annotation,
  color,
  onReveal,
  onSetNote,
  onRemove,
  editing,
  onEditingHandled,
}: {
  annotation: Annotation;
  color: string | undefined;
  onReveal: (annotation: Annotation) => void;
  onSetNote: (annotation: Annotation, body: string) => void;
  onRemove: (id: number) => void;
  /** True when this is the row the document's context menu asked for. */
  editing: boolean;
  onEditingHandled?: () => void;
}) {
  const [open, setOpen] = useState(false);

  // The request is consumed on arrival rather than held: it says "open this
  // one", not "this one is selected", and leaving it set would re-open the
  // editor every time the panel re-rendered — including right after the reader
  // pressed Escape to close it.
  useEffect(() => {
    if (!editing) return;
    setOpen(true);
    onEditingHandled?.();
  }, [editing, onEditingHandled]);

  return (
    <li className="group/row relative rounded-ui-md hover:bg-ui-plane-1">
      <button
        type="button"
        onClick={() => {
          onReveal(annotation);
        }}
        className="block w-full px-1.5 py-1.5 text-left"
      >
        <span className="flex gap-1.5">
          <span
            aria-hidden
            className="mt-[3px] h-[13px] w-[3px] shrink-0 rounded-ui-sm"
            // Falls back to the hairline rather than to nothing for a slot this
            // build does not know — the same forgiveness `paintRanges` shows a
            // colour written by a later version.
            style={{ background: color ?? "var(--ui-hairline)" }}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] leading-snug text-ui-text-muted">
              {oneLine(annotation.quote, 140)}
            </span>
            {annotation.body.length > 0 && (
              <span className="mt-1 block whitespace-pre-wrap text-[12.5px] leading-snug text-ui-text">
                {annotation.body}
              </span>
            )}
          </span>
        </span>
      </button>

      {/* Kept out of the reveal button rather than nested inside it: a button
          inside a button is invalid, and the browser's answer to it is to give
          the click to whichever one it feels like. */}
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity duration-[var(--ui-dur)] group-hover/row:opacity-100 focus-within:opacity-100">
        <RowButton
          label={annotation.body.length > 0 ? "Edit note" : "Add note"}
          onClick={() => {
            setOpen(true);
          }}
        >
          <span aria-hidden className="text-[11px] leading-none">
            {annotation.body.length > 0 ? "Edit" : "Note"}
          </span>
        </RowButton>
        <RowButton
          label="Delete highlight"
          onClick={() => {
            onRemove(annotation.id);
          }}
        >
          <Trash2 size={13} strokeWidth={1.5} aria-hidden />
        </RowButton>
      </div>

      {open && (
        <NoteEditor
          initial={annotation.body}
          onCancel={() => {
            setOpen(false);
          }}
          onSave={(body) => {
            setOpen(false);
            onSetNote(annotation, body);
          }}
        />
      )}
    </li>
  );
}

function RowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-5 min-w-5 place-items-center rounded-ui-sm px-1",
        "bg-ui-base text-ui-text-muted transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-2 hover:text-ui-text-strong",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The note box.
 *
 * Saves on blur as well as on the keyboard, matching the source view next door:
 * a reader who types a note and clicks back onto the document has finished
 * writing it, and losing that to a missing Enter is the same lost-edit the
 * textarea's own `onBlur` exists to prevent. Escape is the one way out that
 * discards, and it does so before the blur can fire.
 *
 * **It survives exactly one focus theft, and that is a fix rather than a
 * flourish.** Opening this from the document's context menu means the article —
 * `contentEditable`, holding the selection the mark was made from, and the
 * menu's own trigger — takes focus back as the menu unmounts. Measured in the
 * running window, that lands within a millisecond of this box being focused,
 * whenever this box is focused: delaying by a frame only moves the theft with
 * it. The blur it caused then ran save-on-blur and closed the editor, so the
 * menu row appeared to do nothing at all. No unit test can see this, and nothing
 * about the code reads as wrong.
 *
 * So a blur is only the reader finishing if it could plausibly have come from
 * them: after they have typed or clicked in the box, or long enough after focus
 * that no unmount is still in flight. Anything else is answered by taking focus
 * back, once. Once matters — a permanent grab would fight a reader who really
 * did click away, and the theft only ever happens on that one unmount.
 */
/** How soon after focus a blur is assumed to be someone else's. Two orders of
 *  magnitude above the observed steal and an order below a human click. */
const THEFT_WINDOW_MS = 150;

function NoteEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  /** When this box last took focus, and whether the reader has used it. Both
   *  feed the one question `onBlur` has to answer: was that blur theirs? */
  const focusedAt = useRef(0);
  const touched = useRef(false);
  const recovered = useRef(false);

  const take = () => {
    focusedAt.current = performance.now();
    ref.current?.focus();
    ref.current?.select();
  };

  useEffect(take, []);

  return (
    <div className="px-1.5 pb-1.5">
      <textarea
        ref={ref}
        value={draft}
        rows={3}
        placeholder="Your note"
        aria-label="Note"
        onChange={(event) => {
          touched.current = true;
          setDraft(event.target.value);
        }}
        onPointerDown={() => {
          touched.current = true;
        }}
        onKeyDown={(event) => {
          // Not bare Enter: a note is prose and wants paragraphs. Ctrl+Enter is
          // the commit chord everywhere a multi-line box has one.
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onSave(draft.trim());
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            onCancel();
          }
          // Stopped here whatever the key was: every chord in the app is
          // registered on `window`, so an unguarded `w` typed into this box
          // closes the tab it belongs to.
          event.stopPropagation();
        }}
        onBlur={() => {
          if (cancelled.current) return;
          const theirs = touched.current || performance.now() - focusedAt.current > THEFT_WINDOW_MS;
          if (!theirs && !recovered.current) {
            recovered.current = true;
            take();
            return;
          }
          onSave(draft.trim());
        }}
        className={cn(
          "w-full resize-none rounded-ui-md bg-ui-plane-2 px-1.5 py-1",
          "text-[12.5px] leading-snug text-ui-text placeholder:text-ui-text-muted",
          "outline-none focus-visible:ring-1 focus-visible:ring-ui-ember",
        )}
      />
    </div>
  );
}
