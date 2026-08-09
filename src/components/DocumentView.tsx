import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Document } from "@/lib/ipc";
import type { Theme } from "@/lib/theme/schema";
import { FormatMenu } from "@/components/FormatMenu";
import { Frontmatter } from "@/components/Frontmatter";
import { useAnnotations } from "@/hooks/useAnnotations";
import { useDocumentTyping } from "@/hooks/useDocumentTyping";
import { overlaps } from "@/lib/annotate/anchor";
import { applyFormat, type FormatCommand } from "@/lib/edit/format";
import {
  annotationRange,
  restoreSelection,
  selectionRange,
  type SourceRange,
} from "@/lib/edit/selection";
import { taskClickHandler } from "@/lib/edit/tasks";
import { enhance } from "@/lib/render/enhance";
import { hasBlockedImages, loadBlockedImages } from "@/lib/render/images";
import { mirror, type Mirrored } from "@/lib/render/mirror";
import { linkClickHandler } from "@/lib/render/links";

/** Keyed by `event.key` lowercased, so Ctrl+Shift+B never reaches them. */
const FORMAT_KEYS: Record<string, FormatCommand> = {
  b: "bold",
  i: "italic",
  "`": "code",
};

/**
 * Renders the document and runs the enhancement passes over it.
 *
 * The HTML arrives already sanitized from Rust (`markdown.rs` runs comrak with
 * `unsafe_` on and then ammonia), which is what makes writing it into the DOM
 * acceptable here. It is done imperatively rather than through
 * `dangerouslySetInnerHTML` so that React never re-creates the nodes the
 * enhancement passes have decorated — and through `mirror`, which replaces only
 * the blocks an edit actually changed, so those nodes survive a re-render too.
 */

interface DocumentViewProps {
  document: Document;
  theme: Theme;
  blockRemoteImages: boolean;
  pendingAnchor: string | null;
  onAnchorConsumed: () => void;
  onOpenDocument: (path: string, fragment: string) => void;
  onScrollerReady: (element: HTMLElement | null) => void;
  /** Writes edited Markdown. Resolves false if the write was refused. */
  onSave: (source: string) => Promise<boolean>;
  /** Show the Markdown rather than the rendered page. Owned above so the
   *  toolbar can reflect it. */
  sourceMode: boolean;
  onToggleSource: () => void;
  /** False for a background tab: still mounted, so its highlighted code and
   *  rendered diagrams survive, but not drawn. */
  visible?: boolean;
  /**
   * Show this document without any way to change it, whatever the file allows.
   *
   * Set by the comparison pane, and it means something different from
   * `doc.editable`. That flag says the *file* cannot be written — plain text,
   * MDX — and `files::save` enforces it in Rust. This one says *this view* is
   * not the place to write it: the same file is editable as ever in its own
   * tab. It is an affordance, not a boundary, which is why the pane also passes
   * an `onSave` that refuses rather than relying on this prop alone.
   */
  readOnly?: boolean;
  /** Where this tab was scrolled to when it was last on screen. */
  restoreScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
}

export function DocumentView({
  document: doc,
  theme,
  blockRemoteImages,
  pendingAnchor,
  onAnchorConsumed,
  onOpenDocument,
  onScrollerReady,
  onSave,
  sourceMode,
  onToggleSource,
  visible = true,
  readOnly = false,
  restoreScrollTop = 0,
  onScrollChange,
}: DocumentViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [blocked, setBlocked] = useState(false);

  /** Whether this view offers editing at all: the file has to allow it *and*
   *  this has to be a view that writes. Everything below asks this rather than
   *  `doc.editable`, so a single flag covers the caret, the format menu, the
   *  checkboxes and the source view together — four affordances that would
   *  otherwise each need remembering. */
  const editable = doc.editable && !readOnly;

  /**
   * Whether this view offers annotating, which is **not** the same question as
   * `editable`.
   *
   * A mark writes to its own database and never to the file, so a document being
   * unwritable is no reason to refuse one. What is a reason is having nothing to
   * anchor against: `files.rs` builds a block map only for Markdown, so plain
   * text and MDX have no offsets a mark could survive an edit with.
   *
   * The comparison pane is excluded separately and for a different reason — it
   * is a reference held still beside your work, with no panel to show a note in.
   */
  const canAnnotate = doc.blocks.length > 0 && !readOnly;

  // The article as state rather than only a ref, because painting has to re-run
  // when it arrives and a ref does not cause a render.
  const [articleElement, setArticleElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setArticleElement(articleRef.current);
  }, []);
  const annotations = useAnnotations(canAnnotate ? doc : null, articleElement);

  useEffect(() => {
    if (!visible) return;
    onScrollerReady(scrollerRef.current);
    return () => {
      onScrollerReady(null);
    };
  }, [onScrollerReady, visible]);

  // Layout effect, not effect: the HTML has to be in place before the browser
  // paints, or every document open flashes empty first.
  //
  // Scroll only resets when a *different* document arrives. Re-rendering the
  // same one is what an edit does, and jumping to the top after every tick of a
  // checkbox would make the document unusable.
  const shown = useRef<string | null>(null);
  /** What the article was last built from, so an edit replaces only the blocks
   *  it changed. Dropped on a document change, which is a full rebuild. */
  const mirrored = useRef<Mirrored | null>(null);
  useLayoutEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const opening = shown.current !== doc.path;
    mirrored.current = mirror(article, doc.html, opening ? null : mirrored.current);
    if (opening) {
      shown.current = doc.path;
      scrollerRef.current?.scrollTo({ top: 0 });
    }
  }, [doc.path, doc.html]);

  // Hiding a tab with `display: none` destroys its layout box and with it the
  // scroll offset, so coming back has to put it there again. Deliberately keyed
  // on `visible` alone: a genuine load resets to the top in the effect above,
  // and this must not undo that.
  const restore = useRef(restoreScrollTop);
  restore.current = restoreScrollTop;
  useLayoutEffect(() => {
    if (!visible) return;
    scrollerRef.current?.scrollTo({ top: restore.current });
  }, [visible]);

  // Reported continuously rather than captured on the way out: by the time an
  // effect cleanup runs, `display: none` has already been applied and the
  // offset is gone.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !onScrollChange) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        onScrollChange(scroller.scrollTop);
      });
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [onScrollChange]);

  // Where the selection should end up once an edit has come back rendered. Held
  // rather than applied immediately: the document it describes does not exist
  // yet at the point the edit is made.
  const restoring = useRef<SourceRange | null>(null);

  // Put the selection back over the words the edit described, against the *new*
  // map — the offsets describe the document as it now is. Without this, applying
  // Bold twice means reselecting in between.
  useLayoutEffect(() => {
    const article = articleRef.current;
    const range = restoring.current;
    if (!article || !range) return;
    restoring.current = null;
    restoreSelection(article, doc.blocks, range);
  }, [doc.html, doc.blocks]);

  // Re-runs on a theme change too: syntax highlighting and Mermaid both bake the
  // palette in, so they have to be redone when it changes.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;

    const stop = enhance(article, {
      theme,
      dir: doc.dir,
      blockRemoteImages,
    });
    setBlocked(hasBlockedImages(article));
    return stop;
  }, [doc.path, doc.html, doc.dir, theme, blockRemoteImages]);

  useEffect(() => {
    const article = articleRef.current;
    const scroller = scrollerRef.current;
    if (!article || !scroller) return;

    const handler = linkClickHandler({
      dir: doc.dir,
      openDocument: onOpenDocument,
      scrollToAnchor: (id) => {
        scrollToAnchor(scroller, id);
      },
    });
    article.addEventListener("click", handler);
    return () => {
      article.removeEventListener("click", handler);
    };
  }, [doc.dir, onOpenDocument]);

  // Ticking a checkbox writes to the file. Read through a ref so the listener is
  // not rebuilt on every save — and so it always edits the newest source rather
  // than whichever one it closed over.
  const source = useRef(doc.source);
  source.current = doc.source;
  useEffect(() => {
    const article = articleRef.current;
    if (!article || !editable) return;

    const handler = taskClickHandler({
      source: () => source.current,
      save: onSave,
    });
    article.addEventListener("click", handler);
    return () => {
      article.removeEventListener("click", handler);
    };
  }, [onSave, editable]);

  // The selection is captured when the menu opens rather than when a row is
  // chosen: opening the menu can collapse the selection, and by the time the
  // reader picks "Bold" there may be nothing left to apply it to.
  const pending = useRef<SourceRange | null>(null);
  const [canFormat, setCanFormat] = useState(false);

  /** The same right-click, resolved the annotation way: both ends may sit in
   *  different blocks, because marking a span rewrites nothing. */
  const pendingMark = useRef<SourceRange | null>(null);
  const [canHighlight, setCanHighlight] = useState(false);
  const [canRemoveHighlight, setCanRemoveHighlight] = useState(false);

  const onContextMenu = () => {
    const range = selectionRange(doc.blocks, window.getSelection());
    pending.current = range;
    setCanFormat(range !== null && range.end > range.start);

    const mark = annotationRange(doc.blocks, window.getSelection());
    pendingMark.current = mark;
    setCanHighlight(mark !== null);
    // Removal works off the caret as well as a selection, so that clicking
    // inside a mark offers to take it off without selecting it first.
    const at = mark ?? selectionRange(doc.blocks, window.getSelection());
    setCanRemoveHighlight(at !== null && annotations.marks.some((m) => overlaps(m.range, at)));
  };

  const formatRange = (range: SourceRange | null, command: FormatCommand) => {
    if (!range) return;
    // Applied to the Markdown, never to the rendered HTML — the source is the
    // document and this view is a projection of it.
    const edit = applyFormat(doc.source, range, command);
    restoring.current = edit.selection;
    void onSave(edit.source).then((saved) => {
      if (!saved) restoring.current = null;
    });
  };

  /** The context menu resolves the range once, when it opens — see
   *  `onContextMenu` — so by the time a row is chosen the selection may be
   *  gone and `pending` is the only record of it. */
  const format = (command: FormatCommand) => {
    formatRange(pending.current, command);
  };

  /** The keyboard has no such gap: the selection is still live at the moment
   *  the chord arrives, so read it directly rather than depending on a menu
   *  having been opened first. */
  const formatSelection = (command: FormatCommand) => {
    const range = selectionRange(doc.blocks, window.getSelection());
    formatRange(range && range.end > range.start ? range : null, command);
  };

  useDocumentTyping({
    article: articleRef,
    document: doc,
    onSave,
    restoring,
  });

  const sourceRef = useRef<HTMLTextAreaElement>(null);
  /** The Markdown being edited directly, or null when the reader is looking at
   *  the rendered document. Held here rather than read from `doc.source` so a
   *  save coming back mid-sentence cannot fight the reader's typing. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Where to put the caret when the source view opens. */
  const entryOffset = useRef(0);

  const openSource = (offset: number | null) => {
    entryOffset.current = offset ?? 0;
    setDraft(doc.source);
  };

  /** Set when leaving the source view triggered a save, so the caret waits for
   *  the re-render instead of being placed against the document being replaced. */
  const savingOnExit = useRef(false);

  const closeSource = () => {
    const textarea = sourceRef.current;
    const edited = draft;
    setDraft(null);
    if (!textarea || edited === null) return;

    // Land on the same words on the way back. The offset is into the source,
    // which is exactly what the map speaks.
    const at = textarea.selectionStart;
    restoring.current = { start: at, end: at };

    // Autosave has usually already written what is in the box, in which case
    // there is no re-render coming and the caret has to be placed as soon as the
    // rendered view is back on screen.
    savingOnExit.current = edited !== doc.source;
    if (savingOnExit.current) void onSave(edited);
  };

  // The mode is owned above this component so the toolbar can show it, and is
  // followed here. Opening reads the caret first, because that is what decides
  // where the source view lands.
  useEffect(() => {
    if (sourceMode && draft === null) {
      openSource(selectionRange(doc.blocks, window.getSelection())?.start ?? 0);
    } else if (!sourceMode && draft !== null) {
      closeSource();
    }
    // Only when the mode itself changes: `draft` moves on every keystroke, and
    // reacting to that would close the view out from under the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);

  // The textarea grows to fit its content so the document's own scroller
  // handles scrolling, exactly as it does for the rendered view. A textarea
  // left at its default height would put a second scrollbar inside the first.
  useLayoutEffect(() => {
    const textarea = sourceRef.current;
    if (draft === null || !textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  // Put the caret where the reader was reading, and scroll it into view — a
  // source view that opens at the top of a long document has thrown away the
  // one thing the reader was looking at.
  const inSource = draft !== null;
  useLayoutEffect(() => {
    const textarea = sourceRef.current;
    if (!inSource) {
      // Back on the rendered document with nothing to wait for.
      const article = articleRef.current;
      const range = restoring.current;
      if (article && range && !savingOnExit.current) {
        restoring.current = null;
        restoreSelection(article, doc.blocks, range);
      }
      savingOnExit.current = false;
      return;
    }
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(entryOffset.current, entryOffset.current);

    // The textarea is its full height by now, so a line's position is its share
    // of that height. Good enough to land the reader on the right paragraph,
    // which is all this has to do.
    const lines = textarea.value.split("\n").length;
    const before = textarea.value.slice(0, entryOffset.current).split("\n").length - 1;
    const top = (textarea.offsetHeight / Math.max(1, lines)) * before;
    scrollerRef.current?.scrollTo({ top: Math.max(0, top - 120) });
    // Deliberately keyed on `inSource` alone. This effect exists to place the caret
    // when the reader switches between the rendered and source views; adding
    // `doc.blocks` would re-run it on every edit and yank the caret mid-typing. The
    // closure is rebuilt each render, so the `doc.blocks` it reads is never stale —
    // it is the *re-running* that would be wrong, not the value.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [inSource]);

  // Typing in the source view reaches the file the same way typing in the
  // rendered one does. Without this an edit would live only in memory until the
  // reader happened to click away.
  const sourceTimer = useRef<number | null>(null);
  const editSource = (next: string) => {
    setDraft(next);
    if (sourceTimer.current !== null) window.clearTimeout(sourceTimer.current);
    sourceTimer.current = window.setTimeout(() => void onSave(next), 600);
  };
  useEffect(
    () => () => {
      if (sourceTimer.current !== null) window.clearTimeout(sourceTimer.current);
    },
    [],
  );

  const copySelection = () => {
    const text = window.getSelection()?.toString() ?? "";
    if (text) void navigator.clipboard.writeText(text);
  };

  // A link that carried an anchor scrolls once the document has rendered. Two
  // frames, because the first only guarantees the HTML is in the DOM — the
  // second lets layout settle so `offsetTop` is the final one.
  useEffect(() => {
    if (!pendingAnchor) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        scrollToAnchor(scroller, pendingAnchor);
        onAnchorConsumed();
      }),
    );
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pendingAnchor, doc.path, onAnchorConsumed]);

  return (
    <div
      ref={scrollerRef}
      className="doc-scroller"
      // `display: none` rather than unmounting: the enhancement passes mark the
      // code blocks and diagrams they have already done, and those markers live
      // on the DOM nodes. Keep the nodes and re-showing a tab is free; throw
      // them away and every switch re-highlights and re-renders from scratch.
      style={visible ? undefined : { display: "none" }}
      aria-hidden={visible ? undefined : true}
      // Tabbable, so a keyboard user can reach the document and scroll it with
      // Page Up/Down. Not auto-focused: the focus ring would then be painted
      // around the page permanently, on every document, for everyone.
      // Keyboard scrolling without focusing is handled in App's key handler.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard (WCAG 2.1.1); see the note above
      tabIndex={0}
      role="region"
      aria-label={`${doc.title}, document content`}
    >
      {blocked && (
        <div className="doc-notice">
          <span>Remote images are blocked so opening a document cannot report that you did.</span>
          <button
            type="button"
            onClick={() => {
              if (!articleRef.current) return;
              loadBlockedImages(articleRef.current);
              setBlocked(false);
            }}
          >
            Load images
          </button>
        </div>
      )}
      {/* Above the article rather than under the title, and that is a constraint
          rather than a preference: `mirror` tracks the article's top-level blocks
          *positionally*, so a node inserted into `.doc` that comrak did not emit
          makes every edit fall back to rebuilding the whole document. A sibling in
          the scroller — the same place `.doc-notice` sits — costs nothing.

          Hidden with the source view, where the raw file is on screen with its
          frontmatter already in it. */}
      {/* Truthy rather than `!== null`, to agree with the exporter: a document
          that opens `---\n---` has *empty* frontmatter, and an empty disclosure
          is a control with nothing behind it. Keyed on the path because
          `<details>` holds its own open state — this component is reused when a
          link re-points the same tab, so without the key the next document
          arrives with its frontmatter already expanded. */}
      {doc.frontmatter && draft === null && <Frontmatter key={doc.path} text={doc.frontmatter} />}

      {draft !== null && (
        <textarea
          ref={sourceRef}
          className="doc-source"
          value={draft}
          spellCheck={false}
          aria-label={`${doc.title}, Markdown source`}
          onChange={(event) => {
            editSource(event.target.value);
          }}
          onBlur={() => {
            if (draft !== doc.source) void onSave(draft);
          }}
        />
      )}

      <FormatMenu
        // Nothing in this menu can act on a document that cannot be written back,
        // and `FormatMenu` already holds that a row which does nothing is worse
        // than a row that is not there.
        canFormat={canFormat && editable}
        onFormat={format}
        onCopy={copySelection}
        // Offered wherever there is a source map to anchor to, which is a wider
        // set than `editable`: a mark writes to its own database, never to the
        // file. Absent entirely rather than disabled where annotating is off.
        onHighlight={
          canAnnotate && annotations.supported
            ? (slot) => {
                if (pendingMark.current) annotations.highlight(pendingMark.current, slot);
              }
            : undefined
        }
        canHighlight={canHighlight}
        canRemoveHighlight={canRemoveHighlight}
        onRemoveHighlight={() => {
          const at = pendingMark.current ?? pending.current;
          if (at) annotations.removeAt(at);
        }}
        onEditSource={editable ? onToggleSource : undefined}
        // The menu asks once, when it opens: a selection can be gone by the
        // time a row is chosen, and greying the rows out afterwards would be
        // worse than deciding up front.
      >
        {/* A right-click menu on the document body is ordinary reader behaviour; the rule
            is aimed at click handlers that fake a button out of a div. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- context menu on document content */}
        <article
          ref={articleRef}
          className="doc"
          onContextMenu={onContextMenu}
          // Kept mounted while the source view is up: the enhancement passes
          // record what they have already done on these nodes, so hiding costs
          // nothing and unmounting would mean re-highlighting the whole
          // document on the way back.
          style={draft === null ? undefined : { display: "none" }}
          // The chords `FormatMenu` prints beside Bold, Italic and Code. Bound
          // on the article rather than the window because they act on this
          // document's selection, and background tabs stay mounted — a global
          // listener would fire for all of them. The browser's own
          // `formatBold` is suppressed in `useDocumentTyping`, so without this
          // the menu was advertising keys that did nothing at all.
          onKeyDown={(event) => {
            if (!editable) return;
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
            const command = FORMAT_KEYS[event.key.toLowerCase()];
            if (!command) return;
            event.preventDefault();
            formatSelection(command);
          }}
          // Editing is available wherever it can be honoured, with no mode to
          // find. The browser is never allowed to act on the input; see
          // `useDocumentTyping`.
          //
          // The exception is a document Rust will refuse to save — plain text,
          // which has no Markdown to rewrite, and MDX, whose pre-pass moves the
          // positions an edit is applied with. Leaving `contentEditable` on for
          // those would give the reader a caret, accept their typing, and then
          // drop it: the silent no-op that a read-only file must never look like.
          // `save` refuses regardless; this is the affordance, not the guard.
          //
          // The comparison pane joins them through `readOnly` for a different
          // reason — the file is writable, that pane just is not where it is
          // written. Turning the caret off here is also what makes
          // `useDocumentTyping` inert there, since `beforeinput` never fires on
          // a node that is not editable.
          contentEditable={editable}
          suppressContentEditableWarning
          spellCheck={false}
        />
      </FormatMenu>
    </div>
  );
}

function scrollToAnchor(scroller: HTMLElement, id: string): void {
  const target = scroller.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  if (!target) return;
  // A little headroom so the heading does not sit flush against the titlebar.
  scroller.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: "smooth" });
}
