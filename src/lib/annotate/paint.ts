import { domPositionOf, indexBySourcepos, type SourceRange } from "@/lib/edit/selection";
import type { BlockMap } from "@/lib/ipc";
import { MARK_SLOTS, type MarkSlot } from "@/lib/theme/apply";

/**
 * Putting highlights on screen.
 *
 * Via the **CSS Custom Highlight API**, exactly as `useFind` does, and for a
 * reason that goes beyond tidiness here: wrapping a mark in a `<mark>` element
 * would insert a node into `.doc`, and `render/mirror.ts` tracks the article's
 * top-level blocks positionally. One node comrak did not emit and every keystroke
 * falls back to rebuilding the whole document — the 223ms → 30ms optimisation,
 * silently gone — while `enhance()` loses the decorations it recorded on the
 * nodes it wrapped. The API paints over ranges and touches nothing.
 *
 * One registered highlight per colour slot rather than one per mark, because the
 * registry maps a name to a *set* of ranges and the name is what CSS selects on.
 */

/** The registry name for a slot. Namespaced, since it is global to the page. */
export function highlightName(slot: string): string {
  return `lindo-md-mark-${slot}`;
}

export const HIGHLIGHT_NAMES = MARK_SLOTS.map(highlightName);

/** What `paintRanges` needs to know about a mark: where it is, and its colour. */
export interface PaintableMark {
  range: SourceRange;
  color: string;
}

/**
 * Turns resolved source ranges into DOM ranges, grouped by colour slot.
 *
 * A mark whose ends cannot be placed on screen is **dropped rather than
 * approximated**. `domPositionOf` deliberately falls back to the nearest position
 * it can find, because for a caret being one character out beats being thrown to
 * the top of the document — but a highlight has no such excuse: the fallback
 * produces a collapsed or arbitrary span, and painting the wrong words is exactly
 * the failure the anchor's orphan rule exists to avoid. Silently painting nothing
 * is the honest outcome, and the mark is still in the panel and still exports.
 */
export function paintRanges(
  article: HTMLElement,
  blocks: BlockMap[],
  marks: PaintableMark[],
): Map<string, Range[]> {
  const grouped = new Map<string, Range[]>();
  if (marks.length === 0) return grouped;

  // One sweep of the article, shared by every lookup. `domPositionOf` takes this
  // for exactly this reason — its own comment records that one sweep per lookup
  // inside a loop was the most expensive thing an edit did, and this effect
  // re-runs on every keystroke because `doc.html` is one of its dependencies.
  // Two lookups per mark meant 2 × marks full sweeps per render.
  const index = indexBySourcepos(article);

  for (const mark of marks) {
    const range = domRangeOf(article, blocks, mark.range, index);
    if (!range) continue;

    const name = highlightName(isSlot(mark.color) ? mark.color : MARK_SLOTS[0]);
    const existing = grouped.get(name);
    if (existing) existing.push(range);
    else grouped.set(name, [range]);
  }

  return grouped;
}

/**
 * One source range as a DOM range, or null where it cannot honestly be placed.
 *
 * Split out of `paintRanges` because the panel needs the same answer for a
 * different purpose — scrolling to a mark the reader clicked — and the refusals
 * are the valuable part. A caller that rebuilt this would get the happy path
 * right and quietly differ on the three ways it can go wrong.
 *
 * `index` is a sweep of the article shared across a batch; without one, each
 * call sweeps for itself, which is fine for a single lookup and quadratic for a
 * document's worth.
 */
export function domRangeOf(
  article: HTMLElement,
  blocks: BlockMap[],
  source: SourceRange,
  index?: ReturnType<typeof indexBySourcepos>,
): Range | null {
  const sweep = index ?? indexBySourcepos(article);
  const start = domPositionOf(article, blocks, source.start, sweep);
  const end = domPositionOf(article, blocks, source.end, sweep);
  if (!start || !end) return null;

  const range = article.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    // The two ends came back in the wrong order, which `setEnd` refuses. Only
    // reachable if the block map and the DOM disagree about document order.
    return null;
  }
  // A collapsed range paints nothing and scrolls to a point that was picked by a
  // fallback rather than by the mark, so it is refused in both directions.
  return range.collapsed ? null : range;
}

/** A colour this build knows how to paint. A row naming a slot from a later
 *  version paints in the first slot rather than not at all — the reader marked
 *  those words either way, and an invisible highlight reads as data loss. */
function isSlot(color: string): color is MarkSlot {
  return (MARK_SLOTS as readonly string[]).includes(color);
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

export function supportsHighlights(): boolean {
  return registry() !== null && typeof globalThis.Highlight === "function";
}

/** Replaces every mark highlight with `grouped`. Slots with nothing in them are
 *  deleted rather than set empty, so a stale set cannot outlive a document. */
export function applyHighlights(grouped: Map<string, Range[]>): void {
  const highlights = registry();
  if (!highlights) return;

  for (const name of HIGHLIGHT_NAMES) {
    const ranges = grouped.get(name);
    if (ranges && ranges.length > 0) highlights.set(name, new Highlight(...ranges));
    else highlights.delete(name);
  }
}

export function clearHighlights(): void {
  const highlights = registry();
  if (!highlights) return;
  for (const name of HIGHLIGHT_NAMES) highlights.delete(name);
}
