import type { SourceRange } from "@/lib/edit/selection";

/**
 * Keeping a mark pointing at the words it was put on, across edits to the file.
 *
 * An annotation records where it is **twice**, because neither way survives on
 * its own. A pair of offsets is exact and free to resolve, and is invalidated by
 * any edit above it — insert one character in the first paragraph and every mark
 * below has moved. The quoted text with a little context either side survives
 * that, and costs a search, and is ambiguous when the same phrase occurs twice.
 * So: trust the offsets while the document is provably unchanged, and search only
 * when it is not.
 *
 * **Every offset here is an index into `Document.source` as a JavaScript string**,
 * which is to say UTF-16 code units into the LF-normalized text — the same
 * numbers `srcmap` hands the webview and `data-sourcepos` describes. Nothing in
 * this file should ever see a byte offset or a file's raw bytes; a document with
 * an em-dash in it makes those two different numbers, and a CRLF file makes them
 * differ by one per preceding line.
 */

/** How much text either side of the quote is kept. Enough to tell two ordinary
 *  repetitions of a phrase apart, short enough that an edit nearby does not
 *  usually destroy both ends at once. */
export const CONTEXT = 32;

export interface Anchor {
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  /** The `contentHash` of the source these offsets were computed against. */
  anchoredHash: string;
}

export type Resolution =
  /** The document is unchanged since this anchor was written; the offsets stand. */
  | { status: "exact"; range: SourceRange }
  /** Re-found somewhere else. The caller should persist the new offsets and hash,
   *  or the search runs again on every load. */
  | { status: "moved"; range: SourceRange }
  /** The quoted text is gone, or occurs in so many equally plausible places that
   *  picking one would be a guess. The annotation is kept and listed — it is the
   *  reader's note — but nothing is painted, because painting the wrong words is
   *  worse than painting none. */
  | { status: "orphaned" };

/**
 * Describes a range of `source` well enough to find it again later.
 *
 * Returns null for an empty range: with no quoted text there is nothing to search
 * for, so the mark would be unrecoverable after the first edit — and it would fail
 * silently, by pointing somewhere plausible and wrong.
 */
export function createAnchor(
  source: string,
  range: SourceRange,
  contentHash: string,
): Anchor | null {
  const start = Math.max(0, Math.min(range.start, source.length));
  const end = Math.max(start, Math.min(range.end, source.length));
  const quote = source.slice(start, end);
  if (quote.length === 0) return null;

  return {
    quote,
    prefix: source.slice(Math.max(0, start - CONTEXT), start),
    suffix: source.slice(end, Math.min(source.length, end + CONTEXT)),
    startOffset: start,
    endOffset: end,
    anchoredHash: contentHash,
  };
}

/**
 * Where this anchor points in `source` now.
 *
 * The hash is checked first because it is the common case by a wide margin — a
 * document is opened far more often than it is edited — and it makes resolving a
 * hundred marks on an unchanged file a hundred string comparisons rather than a
 * hundred searches.
 *
 * A matching hash whose offsets do *not* spell the quote falls through to the
 * search rather than being trusted. That combination should be impossible, so it
 * means something already went wrong — a hash collision, a row written by a
 * version with a different idea of what the offsets counted — and searching finds
 * the right words where trusting the numbers would paint the wrong ones.
 */
export function resolveAnchor(source: string, contentHash: string, anchor: Anchor): Resolution {
  if (anchor.quote.length === 0) return { status: "orphaned" };

  if (
    anchor.anchoredHash === contentHash &&
    source.slice(anchor.startOffset, anchor.endOffset) === anchor.quote
  ) {
    return { status: "exact", range: { start: anchor.startOffset, end: anchor.endOffset } };
  }

  const found = search(source, anchor);
  if (found === null) return { status: "orphaned" };
  return { status: "moved", range: { start: found, end: found + anchor.quote.length } };
}

/**
 * The most plausible occurrence of the quote, or null if there is no single one.
 *
 * Every occurrence is scored by how much of the recorded context it still has
 * around it — the tail of `prefix` before it, the head of `suffix` after it.
 * Ties are broken by proximity to where the mark used to be, because the usual
 * reason for a move is an edit *elsewhere* shifting everything below it, and the
 * usual size of that shift is small. Two candidates that tie on both context and
 * distance are genuinely indistinguishable, and guessing between them would put a
 * reader's note on a sentence they never marked.
 */
function search(source: string, anchor: Anchor): number | null {
  let best: { at: number; score: number; distance: number } | null = null;
  let ambiguous = false;

  for (
    let at = source.indexOf(anchor.quote);
    at !== -1;
    at = source.indexOf(anchor.quote, at + 1)
  ) {
    const score =
      commonSuffix(source.slice(Math.max(0, at - CONTEXT), at), anchor.prefix) +
      commonPrefix(
        source.slice(at + anchor.quote.length, at + anchor.quote.length + CONTEXT),
        anchor.suffix,
      );
    const distance = Math.abs(at - anchor.startOffset);

    if (best === null || score > best.score || (score === best.score && distance < best.distance)) {
      best = { at, score, distance };
      ambiguous = false;
    } else if (score === best.score && distance === best.distance) {
      ambiguous = true;
    }
  }

  return best === null || ambiguous ? null : best.at;
}

/**
 * Whether a mark covers any of `range` — which is how "remove the highlight I am
 * pointing at" decides what the reader means.
 *
 * Touching does not count. A highlight that ends exactly where the next one
 * begins is a different mark, and a caret resting on the seam belongs to
 * neither; treating a shared boundary as an overlap would delete a mark the
 * reader was not inside. A collapsed range is a caret rather than a selection,
 * so it has to sit *strictly* within a mark.
 */
export function overlaps(mark: SourceRange | null, range: SourceRange): boolean {
  if (!mark) return false;
  if (range.start === range.end) return range.start > mark.start && range.start < mark.end;
  return range.start < mark.end && range.end > mark.start;
}

/** How many characters the two strings share at their ends. */
function commonSuffix(a: string, b: string): number {
  let shared = 0;
  while (
    shared < a.length &&
    shared < b.length &&
    a[a.length - 1 - shared] === b[b.length - 1 - shared]
  ) {
    shared++;
  }
  return shared;
}

/** How many characters the two strings share at their starts. */
function commonPrefix(a: string, b: string): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return shared;
}
