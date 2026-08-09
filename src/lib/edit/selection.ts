import type { BlockMap } from "@/lib/ipc";

/**
 * Turning "what the reader has selected on screen" into "which characters of the
 * file that is".
 *
 * The DOM is asked exactly one thing: how far into a block's text a position
 * sits. Everything after that is arithmetic against the block map Rust built,
 * because only Rust knows that `\*` is two characters of source for one of text.
 */

/**
 * The constructs a caret never goes inside. Their rendered text is not their
 * source text — Shiki, KaTeX and Mermaid see to that.
 *
 * **This list is the DOM half of `srcmap::is_skipped`, and the two have to agree
 * or every offset after the construct is wrong.** A skipped node contributes no
 * run, so the block map's text is short by exactly what the renderer still puts
 * on screen; the walk below has to leave out the same characters. Every other
 * entry in `is_skipped` is already excluded here or renders nothing walkable —
 * an image's children become an attribute, a footnote reference becomes
 * `.footnote-ref`, math carries `data-math-style`, a code block is `pre.code-block`.
 *
 * `a[data-wikilink]` is here because `[[target|label]]` renders its *label* as
 * ordinary text while `is_skipped` emits no run for it, so a paragraph
 * containing one measured seven characters longer in the DOM than in the map for
 * `[[Roadmap#Q3|Roadmap]]`. Everything after it in that block resolved to source
 * offsets that were short by the label's length — which for the editing path
 * meant a keystroke rewriting bytes it did not own, the exact failure adding
 * `WikiLink` to `is_skipped` was meant to stop. **Before adding anything to
 * `is_skipped`, ask what it still renders, and add it here.**
 */
export const ATOM_SELECTOR =
  "pre.code-block, figure.mermaid, pre.mermaid-src, [data-math-style], a[data-wikilink]";

/** Text the renderer generated, which no character of the file corresponds to. */
export const GENERATED_SELECTOR = "a.anchor, .footnote-backref, .code-copy, .footnote-ref";

/** The elements a block map entry can be keyed by. `li`, `dt` and `dd` are here
 *  because a paragraph in a *tight* list is not wrapped in `<p>`; its text sits
 *  directly in the item. */
export const MAPPED_SELECTOR = "p, h1, h2, h3, h4, h5, h6, td, th, li, dt, dd";

export interface SourceRange {
  start: number;
  end: number;
}

/**
 * How many UTF-16 units into `block`'s caret-addressable text `node`/`offset`
 * sits, or null if that position is not addressable — inside an atom, or inside
 * text the renderer invented.
 *
 * Counts only text whose nearest mapped ancestor is `block`, which is what keeps
 * a nested list's text with its own item instead of counting it twice.
 */
export function textOffsetOf(block: HTMLElement, node: Node, offset: number): number | null {
  const document = block.ownerDocument;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(candidate) {
      const parent = candidate.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(ATOM_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(GENERATED_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(MAPPED_SELECTOR) !== block) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let seen = 0;
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current === node) return seen + offset;
    seen += current.nodeValue?.length ?? 0;
  }

  // A selection anchored on the element rather than on a text node — which is
  // what a triple-click or a select-all produces.
  if (node === block) return offset === 0 ? 0 : seen;
  return null;
}

/**
 * Converts an offset into a block's text to an offset into the file.
 *
 * A run whose source and text are the same length is walked into directly. One
 * that is not contains an escape, an entity, smart punctuation or a shortcode —
 * the source spells those with more characters than they render to, and there is
 * no meaningful position *inside* one, so the caret goes to whichever end it is
 * nearer. Clamping there is deliberate: a formatting mark placed in the middle
 * of `&amp;` would not misplace a caret, it would corrupt the document.
 */
export function sourceOffsetOf(
  block: BlockMap,
  textOffset: number,
  bias: "start" | "end" = "start",
): number | null {
  if (block.runs.length === 0) return null;

  let seen = 0;
  for (let index = 0; index < block.runs.length; index++) {
    const run = block.runs[index]!;
    const length = run.text.length;
    const finish = seen + length;
    const last = index === block.runs.length - 1;

    // A position on the boundary between two runs belongs to both, and the
    // markup between them — the `**` of an emphasis — is in neither. A
    // selection's *start* takes the later run so that selecting a bold word
    // starts inside its markers; its *end* takes the earlier one so that
    // selecting the text before them ends outside. Getting this backwards
    // produces `****bold****` on the first toggle.
    const claims =
      bias === "end"
        ? textOffset <= finish
        : textOffset < finish || (last && textOffset === finish);

    if (claims) {
      const within = textOffset - seen;
      const linear = run.sourceEnd - run.sourceStart === length;
      if (linear) return run.sourceStart + within;
      return within * 2 >= length ? run.sourceEnd : run.sourceStart;
    }
    seen = finish;
  }

  // Past the last run: the end of the block's text.
  return block.runs[block.runs.length - 1]?.sourceEnd ?? null;
}

/** The block map entry for the element a node sits in, if that block is one the
 *  rendered view is willing to edit. */
export function blockFor(
  blocks: BlockMap[],
  node: Node,
): { element: HTMLElement; map: BlockMap } | null {
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  const element = start?.closest<HTMLElement>(MAPPED_SELECTOR);
  if (!element || element.closest(ATOM_SELECTOR)) return null;

  const sourcepos = element.getAttribute("data-sourcepos");
  if (!sourcepos) return null;

  const map = blocks.find((block) => block.sourcepos === sourcepos);
  return map ? { element, map } : null;
}

/**
 * The inverse of `sourceOffsetOf`: how far into a block's text a file offset is.
 *
 * Null when the offset is not inside this block's text — between two runs, say,
 * where it is sitting on markup rather than on anything the reader can see.
 */
export function textOffsetIn(block: BlockMap, sourceOffset: number): number | null {
  let seen = 0;
  for (const run of block.runs) {
    const length = run.text.length;
    if (sourceOffset >= run.sourceStart && sourceOffset <= run.sourceEnd) {
      const linear = run.sourceEnd - run.sourceStart === length;
      return seen + (linear ? sourceOffset - run.sourceStart : 0);
    }
    // Past this run but before the next: the offset is on markup. The nearest
    // place a caret can actually go is the end of the text before it.
    if (sourceOffset < run.sourceStart) return seen;
    seen += length;
  }
  return sourceOffset >= (block.runs[block.runs.length - 1]?.sourceEnd ?? 0) ? seen : null;
}

/** The text node and offset that sit `textOffset` units into `block`'s text. */
export function nodeAt(
  block: HTMLElement,
  textOffset: number,
): { node: Node; offset: number } | null {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(candidate) {
      const parent = candidate.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(ATOM_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(GENERATED_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(MAPPED_SELECTOR) !== block) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let seen = 0;
  let last: Node | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const length = node.nodeValue?.length ?? 0;
    if (textOffset <= seen + length) return { node, offset: textOffset - seen };
    seen += length;
    last = node;
  }
  return last ? { node: last, offset: last.nodeValue?.length ?? 0 } : null;
}

/**
 * Every element the block map could name, keyed by its `data-sourcepos`.
 *
 * Built in one pass and handed to whoever needs several lookups. It used to be a
 * `querySelectorAll` per block instead, inside a loop over the blocks — one full
 * sweep of the document to find one element, repeated until the right block came
 * up. That is quadratic in the size of the document, and restoring the caret ran
 * it twice, so putting the caret back after an edit got measurably slower the
 * longer the document was: at 800 blocks it was already the most expensive thing
 * an edit did.
 *
 * A sourcepos is compared as an attribute value rather than built into a
 * selector, which keeps it out of the selector grammar entirely.
 */
function indexBySourcepos(article: HTMLElement): Map<string, HTMLElement> {
  const index = new Map<string, HTMLElement>();
  for (const element of article.querySelectorAll<HTMLElement>("[data-sourcepos]")) {
    const sourcepos = element.getAttribute("data-sourcepos");
    // First wins: comrak nests blocks, and the outermost element carrying a
    // given position is the one the map describes.
    if (sourcepos !== null && !index.has(sourcepos)) index.set(sourcepos, element);
  }
  return index;
}

/**
 * Where in the rendered document a file offset is, after the document has been
 * re-rendered — which is what puts the caret back where the reader left it.
 *
 * Returns null when the offset has no on-screen home: inside a code fence, or on
 * markup between two runs. The caller leaves the caret alone rather than moving
 * it somewhere arbitrary.
 */
export function domPositionOf(
  article: HTMLElement,
  blocks: BlockMap[],
  sourceOffset: number,
  /** Shared by a caller resolving more than one offset against the same
   *  document — building it is a sweep of the whole article. */
  index: Map<string, HTMLElement> = indexBySourcepos(article),
): { node: Node; offset: number } | null {
  let firstSeen: { element: HTMLElement; block: BlockMap } | null = null;
  let before: { element: HTMLElement; block: BlockMap } | null = null;

  for (const block of blocks) {
    const first = block.runs[0];
    const last = block.runs[block.runs.length - 1];
    if (!first || !last) continue;

    const element = index.get(block.sourcepos);
    if (!element) continue;
    firstSeen ??= { element, block };

    if (sourceOffset >= first.sourceStart && sourceOffset <= last.sourceEnd) {
      const textOffset = textOffsetIn(block, sourceOffset);
      if (textOffset !== null) return nodeAt(element, textOffset);
    }
    if (first.sourceStart <= sourceOffset) before = { element, block };
  }

  // Plenty of file offsets have no character on screen: Markdown strips the
  // whitespace at the end of a line, so typing a space there leaves the caret
  // one past everything the reader can see. There is also the markup between
  // two blocks, and the inside of a fence.
  //
  // The caret goes to the nearest place it *can* sit rather than nowhere.
  // Nowhere is not neutral — the rendered document has just been replaced
  // wholesale, so a caret that is not put back is a caret at the top of the
  // file, which is the single most disruptive thing an editor can do to
  // somebody mid-sentence. A character out is nothing by comparison.
  const nearest = before ?? firstSeen;
  if (!nearest) return null;
  const total = nearest.block.runs.reduce((sum, run) => sum + run.text.length, 0);
  return nodeAt(nearest.element, before ? total : 0);
}

/**
 * Puts the reader's selection back over a range of the file.
 *
 * Called after a re-render, so it works against the *new* map — the offsets it
 * is given describe the document as it now is, not as it was when the edit was
 * made.
 */
export function restoreSelection(
  article: HTMLElement,
  blocks: BlockMap[],
  range: SourceRange,
): boolean {
  const index = indexBySourcepos(article);
  const start = domPositionOf(article, blocks, range.start, index);
  const end = domPositionOf(article, blocks, range.end, index);
  if (!start || !end) return false;

  const selection = article.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;

  const domRange = article.ownerDocument.createRange();
  domRange.setStart(start.node, start.offset);
  domRange.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(domRange);
  return true;
}

/**
 * The range of the file a selection covers, or null if it is not something the
 * rendered view can edit.
 *
 * Both ends must land in the **same** block. A selection spanning two paragraphs
 * covers the markup between them — blank lines, list bullets, a fence — and
 * wrapping that in `**` would produce something the reader did not ask for.
 * Refusing is the honest answer until the source view can take over.
 */
export function selectionRange(
  blocks: BlockMap[],
  selection: Selection | null,
): SourceRange | null {
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);

  const anchor = blockFor(blocks, range.startContainer);
  const focus = blockFor(blocks, range.endContainer);
  if (!anchor || !focus) return null;
  if (anchor.map.sourcepos !== focus.map.sourcepos) return null;

  const startText = textOffsetOf(anchor.element, range.startContainer, range.startOffset);
  const endText = textOffsetOf(focus.element, range.endContainer, range.endOffset);
  if (startText === null || endText === null) return null;

  const start = sourceOffsetOf(anchor.map, Math.min(startText, endText), "start");
  const end = sourceOffsetOf(anchor.map, Math.max(startText, endText), "end");
  if (start === null || end === null || end < start) return null;

  return { start, end };
}

/**
 * The range of the file a selection covers, **allowing the two ends to sit in
 * different blocks**.
 *
 * The one-block rule `selectionRange` enforces is a rule about *writing*: a
 * selection spanning two paragraphs covers the blank line, list bullet or fence
 * between them, and wrapping that in `**` produces something nobody asked for.
 * Marking that same span costs nothing, because an annotation writes to its own
 * database and never to the document — and dragging across a paragraph break is
 * how people highlight. So this exists beside `selectionRange` rather than
 * replacing it, and the difference between them is the difference between
 * describing a range and rewriting one.
 *
 * The end still has to come after the start in the *source*, which is not implied
 * by coming after it on screen: a footnote definition renders at the foot of the
 * document from a definition that may sit anywhere in the file, so a selection
 * running from a paragraph into one can be backwards in the file while being
 * forwards in the DOM. That is refused rather than silently reversed.
 */
export function annotationRange(
  blocks: BlockMap[],
  selection: Selection | null,
): SourceRange | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);

  // `getRangeAt` reports its ends in document order regardless of which way the
  // reader dragged, so `startContainer` is always the earlier one on screen.
  const from = endpoint(blocks, range.startContainer, range.startOffset, "start");
  const to = endpoint(blocks, range.endContainer, range.endOffset, "end");
  if (from === null || to === null || to <= from) return null;

  return { start: from, end: to };
}

function endpoint(
  blocks: BlockMap[],
  node: Node,
  offset: number,
  bias: "start" | "end",
): number | null {
  const block = blockFor(blocks, node);
  if (!block) return null;
  const text = textOffsetOf(block.element, node, offset);
  if (text === null) return null;
  return sourceOffsetOf(block.map, text, bias);
}
