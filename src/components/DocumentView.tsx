import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Document } from "@/lib/ipc";
import type { Theme } from "@/lib/theme/schema";
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
}

export function DocumentView({
  document: doc,
  theme,
  blockRemoteImages,
  pendingAnchor,
  onAnchorConsumed,
  onOpenDocument,
  onScrollerReady,
}: DocumentViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    onScrollerReady(scrollerRef.current);
    return () => onScrollerReady(null);
  }, [onScrollerReady]);

  // Layout effect, not effect: the HTML has to be in place before the browser
  // paints, or every document open flashes empty first.
  useLayoutEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    article.innerHTML = doc.html;
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [doc.path, doc.html]);

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
    <div ref={scrollerRef} className="doc-scroller">
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
