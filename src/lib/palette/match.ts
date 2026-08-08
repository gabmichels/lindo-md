/**
 * The fuzzy matcher behind the command palette.
 *
 * Subsequence matching rather than substring, because the whole point of a
 * quick-open is that `renmer` finds `src/lib/render/mermaid.ts`. Each place the
 * query's first character occurs is tried as a beginning: a greedy forward scan
 * says where a match starting there would end, then a backward pass from that
 * end pulls it as tight as it will go, and the best-scoring one wins.
 *
 * Both halves earn their keep. Without the backward pass a match sprawls across
 * every gap the forward scan happened to leave. Without trying each beginning,
 * `mer` against `src/mock/render/mermaid.ts` is anchored on `mock`'s `m` and
 * never reaches the word it was obviously aiming at.
 *
 * There is no dependency here on purpose. `cmdk` and `fuse.js` both do this
 * well, and neither is worth a new entry in a tree that ships inside a
 * downloaded binary (AGENTS.md, Dependencies) for sixty lines of code.
 */

export interface FuzzyMatch {
  /** Higher is better. Only comparable between candidates of the same query. */
  score: number;
  /** Half-open `[start, end)` runs of `text` that the query matched, in order,
   *  merged so adjacent characters form one run — what the row underlines. */
  ranges: [number, number][];
}

/** Long candidates are scored on their tail: a path is distinctive at the end,
 *  and an unbounded scan is a per-keystroke cost over every file in the tree. */
const MAX_LENGTH = 260;

/** How many beginnings are tried before the best one so far is taken as final. */
const MAX_STARTS = 24;

/** A match that begins one of these carries a word-boundary bonus. */
const BOUNDARY = new Set(["/", "\\", "_", "-", ".", " ", ":", "@", "#"]);

/**
 * Scores `query` against `text`, or returns `null` if the characters of the
 * query do not appear in order.
 *
 * An empty query matches everything with a score of 0 and no ranges, so a
 * palette with nothing typed in it shows its items in the order they were
 * built rather than in an arbitrary one.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (query === "") return { score: 0, ranges: [] };

  const haystack = text.length > MAX_LENGTH ? text.slice(text.length - MAX_LENGTH) : text;
  const offset = text.length - haystack.length;

  const lowerQuery = fold(query);
  const lowerText = fold(haystack);

  let best: number[] | null = null;
  let bestScore = -Infinity;
  let starts = 0;

  // Every place the first character occurs is a candidate beginning. Tightening
  // from a single greedy end is not enough on its own: in
  // `src/mock/render/mermaid.ts` the first `m` belongs to `mock`, and a scan
  // anchored there ends at `render`'s `r` — spreading `mer` across the path
  // while the exact word sits further along, unreached.
  for (let from = 0; from < lowerText.length; from += 1) {
    if (lowerText[from] !== lowerQuery[0]) continue;

    const end = forwardEnd(lowerQuery, lowerText, from);
    // No later start can succeed if this one could not, so the scan is over.
    if (end === null) break;

    const positions = tighten(lowerQuery, lowerText, from, end);
    if (positions === null) break;

    const candidate = score(query, haystack, lowerText, positions);
    if (candidate > bestScore) {
      bestScore = candidate;
      best = positions;
    }

    starts += 1;
    // A bound rather than a correctness rule. This runs per keystroke over
    // every candidate in the palette, and a text made of one repeated letter
    // would otherwise cost its own length squared.
    if (starts >= MAX_STARTS) break;
  }

  if (best === null) return null;
  return { score: bestScore, ranges: toRanges(best, offset) };
}

/**
 * Case-folded, one character out for every character in.
 *
 * `toLowerCase()` over a whole string is **not** length-preserving — `İ`
 * (U+0130) lowercases to two code units — and every index this module produces
 * is handed back as an index into the *original* string. One such character
 * anywhere in a filename shifts every range after it, so `notes` in
 * `İstanbul-notes.md` highlighted `otes.`. The fast path is one native call and
 * covers everything else; the slow path keeps the original character wherever
 * folding it would change the length, which means `i` does not match `İ`. That
 * is the right trade: a highlight pointing at the wrong characters is a bug,
 * and one Turkish capital not matching a lowercase `i` is a limitation.
 */
function fold(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;

  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    const folded = char.toLowerCase();
    out += folded.length === 1 ? folded : char;
  }
  return out;
}

/** The index at which a greedy forward scan from `from` finishes, or `null`. */
function forwardEnd(query: string, text: string, from: number): number | null {
  let q = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === query[q]) {
      q += 1;
      if (q === query.length) return i;
    }
  }
  return null;
}

/**
 * The tightest positions for `query` that begin at `from` and end at `end`.
 *
 * Everything after the first character is pulled back as far as it will go; the
 * first is **pinned to `from`**, and that pin is load-bearing. Tightening the
 * anchor too means a query whose first character repeats later loses the
 * earlier, better-placed one: `rt` against `render/theme.ts` slid its `r` from
 * index 0 to index 5, giving up the start-of-string bonus and losing to
 * `assorted.md`. Since the caller already tries every occurrence as a `from`,
 * pinning here costs no coverage — it only stops each start from collapsing
 * onto the same interior match.
 *
 * Written as a bounded scan rather than a `while` that walks backward until it
 * finds a hit: the caller has proved every character is reachable, but an
 * unbounded loop in a per-keystroke path is a hang waiting for the proof to
 * stop holding.
 */
function tighten(query: string, text: string, from: number, end: number): number[] | null {
  const positions: number[] = [];
  let q = query.length - 1;
  for (let cursor = end; cursor > from && q >= 1; cursor -= 1) {
    if (text[cursor] === query[q]) {
      positions.unshift(cursor);
      q -= 1;
    }
  }
  if (q !== 0) return null;

  positions.unshift(from);
  return positions;
}

function score(query: string, text: string, lowerText: string, positions: number[]): number {
  let total = 0;

  for (const [q, at] of positions.entries()) {
    total += 16;

    const previous = positions[q - 1];
    if (previous !== undefined) {
      const gap = at - previous - 1;
      // A run of adjacent characters is what "this is the word I meant" looks
      // like; a gap is tolerated but never free.
      //
      // This has to outweigh the boundary bonus below, and that is not obvious
      // until you see what happens when it does not: every character of
      // `n-o-t-e-0.md` sits after a separator, so with adjacency at 12 and a
      // boundary at 14 the query `note` scored it *above* `note.md`. A word
      // broken into single letters cannot beat the word.
      if (gap === 0) total += 18;
      else total -= Math.min(gap, 12);
    }

    const before = at === 0 ? undefined : lowerText[at - 1];
    if (before === undefined || BOUNDARY.has(before)) total += 14;
    // A capital in the middle of a word is a boundary too — `TabStrip` should
    // be found by `ts`.
    else if (text[at] !== lowerText[at]) total += 8;

    // Case the reader actually typed is a weak signal, so it only breaks ties.
    if (query[q] === text[at]) total += 1;
  }

  // Two tie-breaks, both worth less than any real bonus above: an earlier match
  // beats a later one, and a shorter candidate beats a longer one that contains
  // it — `notes.md` over `release-notes-draft.md`.
  const first = positions[0] ?? 0;
  return total - first * 0.4 - text.length * 0.05;
}

function toRanges(positions: number[], offset: number): [number, number][] {
  const ranges: [number, number][] = [];
  for (const at of positions) {
    const last = ranges.at(-1);
    if (last?.[1] === at) last[1] = at + 1;
    else ranges.push([at, at + 1]);
  }
  return offset === 0 ? ranges : ranges.map(([from, to]) => [from + offset, to + offset]);
}
