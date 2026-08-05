import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Document } from "@/lib/ipc";
import type { Theme } from "@/lib/theme/schema";
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
      <article ref={articleRef} className="doc" />
    </div>
  );
}

function scrollToAnchor(scroller: HTMLElement, id: string): void {
  const target = scroller.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  if (!target) return;
  // A little headroom so the heading does not sit flush against the titlebar.
  scroller.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: "smooth" });
}
