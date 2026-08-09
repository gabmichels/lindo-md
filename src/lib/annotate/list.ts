import type { Annotation } from "@/lib/ipc";
import type { SourceRange } from "@/lib/edit/selection";

/**
 * Turning one document's stored annotations into the list the panel shows.
 *
 * Everything here is pure and works on plain rows, which is the point: the panel
 * itself is then a list and a text box, and the decisions that are easy to get
 * wrong — what order marks come in, what an orphan does to that order, what a
 * one-line quote may throw away — are testable without a DOM.
 *
 * Which document's rows these are is not decided here. That is a question about
 * paths, the store answers it, and the frontend has no business comparing a path
 * it was handed against a canonicalized one — see `useDocumentNotes`.
 */

/** An annotation with wherever it currently resolves to, or null for an orphan.
 *  Mirrors `ResolvedAnnotation` without importing the hook. */
interface Placed {
  range: SourceRange | null;
}

/**
 * This document's marks, in the order they appear on the page.
 *
 * **Orphans go last, in the order they were made, and never interleaved.** They
 * have no position, so any place they are put among the others is invented; at
 * the end they read as what they are — notes whose words have gone. Putting them
 * where their stale offsets *used* to point would be worse than arbitrary, since
 * it is confidently wrong about a document that has since changed.
 *
 * Sorted by a copy: the array belongs to React state, and sorting in place
 * mutates a value another render is holding.
 */
export function inDocumentOrder<T extends Placed & Annotation>(marks: readonly T[]): T[] {
  const placed = marks.filter((mark) => mark.range !== null);
  const orphans = marks.filter((mark) => mark.range === null);
  placed.sort((a, b) => a.range!.start - b.range!.start || a.range!.end - b.range!.end);
  orphans.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  return [...placed, ...orphans];
}

/**
 * Whether a mark answers a query.
 *
 * Searches the note and the quote — the two things a reader would say out loud
 * about a mark. **Not the file name**, which every row in a document-scoped list
 * shares: matching on it would mean typing the name of the file you are reading
 * selects everything, which looks like a broken filter rather than a clever one.
 *
 * Case-insensitive and substring rather than fuzzy: the palette's matcher earns
 * its complexity by ranking a hundred paths against three keystrokes, and this
 * is filtering a list already on screen, where a surprising match is worse than
 * a missing one.
 */
export function matches(annotation: Annotation, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    annotation.body.toLowerCase().includes(needle) ||
    annotation.quote.toLowerCase().includes(needle)
  );
}

/** The marks that answer a query, in the order they came in. A copy either way,
 *  so a caller can hold the result across a render. */
export function filterAnnotations(
  annotations: readonly Annotation[],
  query: string,
): readonly Annotation[] {
  if (query.trim().length === 0) return [...annotations];
  return annotations.filter((annotation) => matches(annotation, query));
}

/**
 * The quote as one line.
 *
 * A mark can span paragraphs — `annotationRange` allows exactly that — so the
 * stored quote can carry newlines and runs of indentation that would turn one
 * row into a wall. Collapsed to single spaces and cut at a word boundary where
 * there is one within reach of the limit, since a cut mid-word reads as a typo
 * rather than as an ellipsis.
 */
export function oneLine(quote: string, limit = 120): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  // `space === -1` is tested for rather than left to the comparison. A single
  // long token — a URL, a hash — has no boundary at all, and `-1` compares as
  // "close enough to the limit" for any limit under 24, at which point
  // `slice(0, -1)` quietly drops a character instead of falling through.
  const boundary = space !== -1 && space > limit - 24;
  return `${boundary ? cut.slice(0, space) : cut}…`;
}
