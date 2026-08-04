import { useCallback, useEffect, useRef, useState } from "react";

/**
 * In-document find.
 *
 * Uses the CSS Custom Highlight API, which paints matches without touching the
 * DOM. That matters here more than usual: wrapping matches in `<mark>` elements
 * would invalidate the enhancement passes that decorated those exact nodes
 * (highlighted code, rendered diagrams) and force them all to run again.
 *
 * Where the API is missing, find degrades to scrolling to each match without
 * painting it — still useful, and better than the alternative of rewriting the
 * document.
 */

export interface FindState {
  query: string;
  setQuery: (query: string) => void;
  matchCount: number;
  activeIndex: number;
  next: () => void;
  previous: () => void;
  clear: () => void;
  supported: boolean;
}

const HIGHLIGHT_ALL = "lindo-md-find";
const HIGHLIGHT_ACTIVE = "lindo-md-find-active";

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

function supportsHighlights(): boolean {
  return registry() !== null && typeof globalThis.Highlight === "function";
}

export function useFind(root: HTMLElement | null): FindState {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const ranges = useRef<Range[]>([]);
  const supported = useRef(supportsHighlights());

  const paint = useCallback((index: number) => {
    const highlights = registry();
    if (!highlights) return;

    const all = ranges.current;
    const active = all[index];
    highlights.set(HIGHLIGHT_ALL, new Highlight(...all));
    if (active) highlights.set(HIGHLIGHT_ACTIVE, new Highlight(active));
    else highlights.delete(HIGHLIGHT_ACTIVE);
  }, []);

  const clearPaint = useCallback(() => {
    const highlights = registry();
    highlights?.delete(HIGHLIGHT_ALL);
    highlights?.delete(HIGHLIGHT_ACTIVE);
  }, []);

  // Re-search whenever the query or the document changes.
  useEffect(() => {
    if (!root || query.trim().length === 0) {
      ranges.current = [];
      setMatchCount(0);
      setActiveIndex(0);
      clearPaint();
      return;
    }

    ranges.current = findRanges(root, query);
    setMatchCount(ranges.current.length);
    setActiveIndex(0);
    paint(0);
    scrollTo(ranges.current[0]);
  }, [query, root, paint, clearPaint]);

  useEffect(() => clearPaint, [clearPaint]);

  const move = useCallback(
    (delta: number) => {
      const count = ranges.current.length;
      if (count === 0) return;
      setActiveIndex((current) => {
        // Wrapping is what a reader expects from find; stopping at the end reads
        // as "no more matches" when there are.
        const next = (current + delta + count) % count;
        paint(next);
        scrollTo(ranges.current[next]);
        return next;
      });
    },
    [paint],
  );

  return {
    query,
    setQuery,
    matchCount,
    activeIndex,
    next: useCallback(() => move(1), [move]),
    previous: useCallback(() => move(-1), [move]),
    clear: useCallback(() => setQuery(""), []),
    supported: supported.current,
  };
}

/**
 * Collects a range per case-insensitive match, walking text nodes directly.
 *
 * Exported for tests: the parts that go wrong are overlapping matches and
 * matches inside nested markup, and both are easier to pin down here than
 * through the hook.
 */
export function findRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip the copy buttons and other chrome we injected into the document.
      const parent = node.parentElement;
      if (!parent || parent.closest(".code-copy")) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && node.nodeValue.trim().length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const found: Range[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = (node.nodeValue ?? "").toLowerCase();
    let from = text.indexOf(needle);
    while (from !== -1) {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, from + needle.length);
      found.push(range);
      // Search past this match rather than one character on, so "aa" in "aaaa"
      // is two matches, not three overlapping ones.
      from = text.indexOf(needle, from + needle.length);
    }
    node = walker.nextNode();
  }

  return found;
}

function scrollTo(range: Range | undefined): void {
  const element =
    range?.startContainer.parentElement ?? (range?.startContainer as HTMLElement | null);
  element?.scrollIntoView({ block: "center", behavior: "smooth" });
}
