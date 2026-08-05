import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Document } from "@/lib/ipc";
import type { Theme } from "@/lib/theme/schema";
import { FormatMenu } from "@/components/FormatMenu";
import { useDocumentTyping } from "@/hooks/useDocumentTyping";
import { applyFormat, type FormatCommand } from "@/lib/edit/format";
import {
  restoreSelection,
  selectionRange,
  type SourceRange,
} from "@/lib/edit/selection";
import { taskClickHandler } from "@/lib/edit/tasks";
import { enhance } from "@/lib/render/enhance";
import { hasBlockedImages, loadBlockedImages } from "@/lib/render/images";
import { linkClickHandler } from "@/lib/render/links";

/**
 * Renders the document and runs the enhancement passes over it.
 *
 * The HTML arrives already sanitized from Rust (`markdown.rs` runs comrak with
 * `unsafe_` on and then ammonia), which is what makes `innerHTML` acceptable
 * here. It is set imperatively rather than through `dangerouslySetInnerHTML` so
 * that React never re-creates the nodes the enhancement passes have decorated.
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
  restoreScrollTop = 0,
  onScrollChange,
}: DocumentViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!visible) return;
    onScrollerReady(scrollerRef.current);
    return () => onScrollerReady(null);
  }, [onScrollerReady, visible]);

  // Layout effect, not effect: the HTML has to be in place before the browser
  // paints, or every document open flashes empty first.
  //
  // Scroll only resets when a *different* document arrives. Re-rendering the
  // same one is what an edit does, and jumping to the top after every tick of a
  // checkbox would make the document unusable.
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    article.innerHTML = doc.html;
    if (shown.current !== doc.path) {
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
      scrollToAnchor: (id) => scrollToAnchor(scroller, id),
    });
    article.addEventListener("click", handler);
    return () => article.removeEventListener("click", handler);
  }, [doc.dir, onOpenDocument]);

  // Ticking a checkbox writes to the file. Read through a ref so the listener is
  // not rebuilt on every save — and so it always edits the newest source rather
  // than whichever one it closed over.
  const source = useRef(doc.source);
  source.current = doc.source;
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;

    const handler = taskClickHandler({
      source: () => source.current,
      save: onSave,
    });
    article.addEventListener("click", handler);
    return () => article.removeEventListener("click", handler);
  }, [onSave]);

  // The selection is captured when the menu opens rather than when a row is
  // chosen: opening the menu can collapse the selection, and by the time the
  // reader picks "Bold" there may be nothing left to apply it to.
  const pending = useRef<SourceRange | null>(null);
  const [canFormat, setCanFormat] = useState(false);

  const onContextMenu = () => {
    const range = selectionRange(doc.blocks, window.getSelection());
    pending.current = range;
    setCanFormat(range !== null && range.end > range.start);
  };

  const format = (command: FormatCommand) => {
    const range = pending.current;
    if (!range) return;
    // Applied to the Markdown, never to the rendered HTML — the source is the
    // document and this view is a projection of it.
    const edit = applyFormat(doc.source, range, command);
    restoring.current = edit.selection;
    void onSave(edit.source).then((saved) => {
      if (!saved) restoring.current = null;
    });
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
  useEffect(() => () => {
    if (sourceTimer.current !== null) window.clearTimeout(sourceTimer.current);
  }, []);

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
    return () => cancelAnimationFrame(frame);
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
      tabIndex={0}
      role="region"
      aria-label={`${doc.title}, document content`}
    >
      {blocked && (
        <div className="doc-notice">
          <span>
            Remote images are blocked so opening a document cannot report that you
            did.
          </span>
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
      {draft !== null && (
        <textarea
          ref={sourceRef}
          className="doc-source"
          value={draft}
          spellCheck={false}
          aria-label={`${doc.title}, Markdown source`}
          onChange={(event) => editSource(event.target.value)}
          onBlur={() => {
            if (draft !== doc.source) void onSave(draft);
          }}
        />
      )}

      <FormatMenu
        canFormat={canFormat}
        onFormat={format}
        onCopy={copySelection}
        onEditSource={onToggleSource}
        // The menu asks once, when it opens: a selection can be gone by the
        // time a row is chosen, and greying the rows out afterwards would be
        // worse than deciding up front.
      >
        <article
          ref={articleRef}
          className="doc"
          onContextMenu={onContextMenu}
          // Kept mounted while the source view is up: the enhancement passes
          // record what they have already done on these nodes, so hiding costs
          // nothing and unmounting would mean re-highlighting the whole
          // document on the way back.
          style={draft === null ? undefined : { display: "none" }}
          // Editing is always available — there is no mode to find. The browser
          // is never allowed to act on the input; see `useDocumentTyping`.
          contentEditable
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
