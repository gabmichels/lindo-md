import type { Annotation } from "@/lib/ipc";
import type { SourceRange } from "@/lib/edit/selection";

/**
 * Turning stored annotations into the two lists the panel shows.
 *
 * Everything here is pure and works on plain rows, which is the point: the panel
 * itself is then a list and a text box, and the decisions that are easy to get
 * wrong — what order marks come in, what an orphan does to that order, what the
 * cross-document view can honestly claim — are testable without a DOM.
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

/** One document's worth of the cross-document list. */
export interface DocumentGroup {
  path: string;
  /** The file's own name, for the heading. The panel shows this and keeps the
   *  full path for the tooltip — a list of twenty `index.md` rows is a list of
   *  twenty identical rows. */
  name: string;
  annotations: Annotation[];
  /** The most recent `updatedAt` in the group, which is what orders the groups. */
  touchedAt: number;
}

/**
 * Every annotation in the database, grouped by the document it belongs to.
 *
 * **Groups are ordered by the most recently touched mark in each, not
 * alphabetically.** The question this list answers is "what have I been
 * flagging", and the answer decays with age; a-to-z would put whatever folder
 * starts with `a` in front of the note made a minute ago.
 *
 * Within a group, marks are ordered by their **stored** offsets. That is the
 * only order available here and it is an honest one to offer: resolving an
 * anchor needs the document's source, and the whole point of this view is to
 * show marks from files that are not open. A mark that has moved since is
 * listed a little out of place, which costs nothing, and its quote — stored for
 * exactly this — is still the words it was put on.
 */
export function byDocument(annotations: readonly Annotation[]): DocumentGroup[] {
  const groups = new Map<string, DocumentGroup>();
  for (const annotation of annotations) {
    const existing = groups.get(annotation.path);
    if (existing) {
      existing.annotations.push(annotation);
      existing.touchedAt = Math.max(existing.touchedAt, annotation.updatedAt);
      continue;
    }
    groups.set(annotation.path, {
      path: annotation.path,
      name: fileName(annotation.path),
      annotations: [annotation],
      touchedAt: annotation.updatedAt,
    });
  }

  const ordered = [...groups.values()];
  for (const group of ordered) {
    group.annotations.sort((a, b) => a.startOffset - b.startOffset || a.id - b.id);
  }
  ordered.sort((a, b) => b.touchedAt - a.touchedAt || a.path.localeCompare(b.path));
  return ordered;
}

/**
 * Moves the document being read to the front of the list.
 *
 * Recency is the right order for the *question* the panel answers, and the wrong
 * one for the document that is on screen: the panel sits beside it, its marks
 * are the ones the reader can act on, and a file opened without being marked
 * today would otherwise sink under everything touched since. Reading and
 * annotating are the same session.
 *
 * Everything below keeps the recency order it had, so this is one group moving
 * rather than a second sort. A path with no marks — the common case on a fresh
 * document — changes nothing.
 */
export function pinCurrent(groups: readonly DocumentGroup[], path: string | null): DocumentGroup[] {
  if (path === null) return [...groups];
  const at = groups.findIndex((group) => group.path === path);
  const current = groups[at];
  if (at <= 0 || !current) return [...groups];
  return [current, ...groups.slice(0, at), ...groups.slice(at + 1)];
}

/**
 * Whether a mark answers a query, which is the "everything I flagged about X"
 * the whole store exists for.
 *
 * Searches the note, the quote **and the file name** — the three things a reader
 * would say out loud. Case-insensitive and substring rather than fuzzy: the
 * palette's matcher earns its complexity by ranking a hundred paths against
 * three keystrokes, and this is filtering a list already on screen, where a
 * surprising match is worse than a missing one.
 */
export function matches(annotation: Annotation, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    annotation.body.toLowerCase().includes(needle) ||
    annotation.quote.toLowerCase().includes(needle) ||
    fileName(annotation.path).toLowerCase().includes(needle)
  );
}

/** Drops groups left with nothing, so filtering never shows a file heading with
 *  no rows under it. */
export function filterGroups(groups: readonly DocumentGroup[], query: string): DocumentGroup[] {
  if (query.trim().length === 0) return [...groups];
  return groups
    .map((group) => ({
      ...group,
      annotations: group.annotations.filter((annotation) => matches(annotation, query)),
    }))
    .filter((group) => group.annotations.length > 0);
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

/** The last segment of a path, on either separator. `lib/utils.ts` has
 *  `basename`, which is the same idea for the same reason; this file keeps its
 *  own so the list logic has no import that is not about lists. */
function fileName(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}
