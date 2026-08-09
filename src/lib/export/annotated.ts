import type { SourceRange } from "@/lib/edit/selection";
import type { Annotation, BlockMap } from "@/lib/ipc";

/**
 * Writing a reader's marks back into the Markdown they were made on.
 *
 * The document leaves with the highlights in it, so the notes survive being
 * taken somewhere else — which is the point of keeping annotations in a database
 * rather than scattered through the files: nothing is written until you ask, and
 * then it is written into a *copy*. This never touches the file on disk; it
 * returns a string the caller saves wherever the reader chose.
 *
 * **A highlight becomes `<mark>`, not `==text==`.** The `==` spelling is the
 * prettier one and the one Obsidian, Bear and Logseq use — but it is an
 * extension none of comrak, GitHub or CommonMark implements, so a file full of
 * it renders as literal equals signs in lindo-md itself and on GitHub. `<mark>`
 * is plain HTML: every one of those renders it, Obsidian included, and it is the
 * only form with somewhere to keep the colour. The class is informational — an
 * exported file carries no stylesheet, so the browser's own `mark` styling is
 * what shows, and `lindo-yellow` is there for a reader who wants to style them.
 *
 * A note becomes a **footnote**, which is the one construct Markdown already has
 * for "a remark attached to this phrase, kept out of the way".
 */

/** A mark to write out: an annotation plus where it currently resolves, which is
 *  null once the words it was put on are gone. Structurally what the document
 *  view already holds, without importing the hook. */
export interface ExportableMark extends Annotation {
  range: SourceRange | null;
}

export interface AnnotatedExport {
  /** The document with its marks written in. */
  markdown: string;
  /** Marks that could not be placed in the text — orphans, and marks that cross
   *  another. They are listed at the end rather than dropped; the caller reports
   *  the count, because silently losing a reader's note is the failure this
   *  whole feature exists to prevent. */
  unplaced: number;
}

/** The heading the unplaceable notes are collected under. */
const STRANDED_HEADING = "Notes without a place in the text";

export function annotatedMarkdown(
  source: string,
  marks: readonly ExportableMark[],
  /** The document's block map, used to split a mark that spans blocks. Omitting
   *  it writes each mark as one element, which is right only when no mark
   *  crosses a blank line. */
  blocks: readonly BlockMap[] = [],
): AnnotatedExport {
  const placed: PlacedMark[] = [];
  const stranded: ExportableMark[] = [];

  // Outermost first, so a mark fully inside another is seen after the one that
  // contains it and can be recognised as nested rather than crossing.
  const candidates = [...marks].sort((a, b) => {
    if (!a.range || !b.range) return a.range ? -1 : b.range ? 1 : a.id - b.id;
    return a.range.start - b.range.start || b.range.end - a.range.end || a.id - b.id;
  });

  for (const mark of candidates) {
    const range = mark.range;
    // An orphan has no offsets that mean anything any more. Resolving is the
    // document view's job and it already refused; guessing here would put the
    // reader's note on a sentence they never marked, which is the one outcome
    // the anchor's orphan rule exists to prevent.
    if (!range || range.end <= range.start || range.end > source.length) {
      stranded.push(mark);
      continue;
    }
    // Nested marks are fine — `<mark>` inside `<mark>` is legal and renders.
    // Crossing ones are not: `<mark>a<mark>b</mark>c` cannot be closed in an
    // order any parser agrees on, so the second one is stranded rather than
    // written out as markup that would corrupt everything after it.
    if (placed.some((other) => crosses(other.range, range))) {
      stranded.push(mark);
      continue;
    }
    placed.push({ ...mark, range });
  }

  const label = labeller(source);
  const notes: { label: string; body: string }[] = [];
  const edits: { at: number; text: string; opening: boolean }[] = [];

  for (const mark of placed) {
    const segments = splitAcrossBlocks(mark.range, blocks);
    if (segments.length === 0) {
      stranded.push(mark);
      continue;
    }

    // The reference is welded onto the closing tag rather than pushed as its own
    // edit at the same offset. Two insertions at one offset come out in reverse,
    // because each one goes in *before* whatever is already there — so a
    // separate `[^1]` would land inside the element it is meant to follow.
    let name = "";
    if (mark.body.trim().length > 0) {
      name = label(mark.id);
      notes.push({ label: name, body: oneParagraph(mark.body) });
    }

    segments.forEach((segment, index) => {
      edits.push({ at: segment.start, text: openTag(mark.color), opening: true });
      // One reference, after the last piece, because it is one note however many
      // blocks the mark had to be cut into.
      const reference = name && index === segments.length - 1 ? `[^${name}]` : "";
      edits.push({ at: segment.end, text: `</mark>${reference}`, opening: false });
    });
  }

  return {
    markdown: assemble(source, edits, notes, stranded),
    unplaced: stranded.length,
  };
}

interface PlacedMark extends Annotation {
  range: SourceRange;
}

/**
 * A mark's range cut into one piece per block it covers.
 *
 * **`<mark>` cannot span a blank line, and it fails by losing text rather than
 * by breaking.** comrak ends the element at the end of its paragraph, so a mark
 * made across two paragraphs — which `annotationRange` deliberately allows, and
 * which the painter shows as one continuous highlight — exported as a single
 * element would mark the first paragraph and leave the rest bare, silently. A
 * Rust test pins that behaviour next to the sanitizer allowlist.
 *
 * Each piece is clipped to the text the block map actually covers, so the
 * markup *between* blocks is never wrapped: a `<mark>` opened in the blank line
 * before a heading would be inline HTML sitting in its own paragraph.
 *
 * With no block map — a caller that has none, or a document that produced none —
 * the range is returned whole, which is what the single-block case wants anyway.
 */
function splitAcrossBlocks(range: SourceRange, blocks: readonly BlockMap[]): SourceRange[] {
  if (blocks.length === 0) return [range];

  const pieces: SourceRange[] = [];
  for (const block of blocks) {
    let start = Infinity;
    let end = -Infinity;
    for (const run of block.runs) {
      // Only the part of this run the mark actually covers.
      const from = Math.max(range.start, run.sourceStart);
      const to = Math.min(range.end, run.sourceEnd);
      if (from >= to) continue;
      start = Math.min(start, from);
      end = Math.max(end, to);
    }
    // One piece per block rather than one per run: a block's runs are broken up
    // by inline markup, and `<mark>` spans that happily — `<mark>a **b** c</mark>`
    // is fine, while a pair around every run would be noise.
    if (start < end) pieces.push({ start, end });
  }

  // Blocks come in document order, so the pieces do too — which the insertion
  // pass relies on for the footnote reference to land after the last one.
  return pieces;
}

/** Two ranges that overlap without either containing the other. */
function crosses(a: SourceRange, b: SourceRange): boolean {
  const overlapping = a.start < b.end && b.start < a.end;
  if (!overlapping) return false;
  const nested = (a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end);
  return !nested;
}

function openTag(color: string): string {
  // The slot name is an identifier from our own table, but it arrives from the
  // database and a row written by a later build could hold anything. Anything
  // that is not a plain slot name is written as a bare `<mark>` rather than
  // interpolated into an attribute.
  return /^[a-z][a-z0-9-]*$/.test(color) ? `<mark class="lindo-${color}">` : "<mark>";
}

/**
 * Footnote labels that cannot collide with the document's own.
 *
 * `lindo-1` is namespaced because the kitchen sink alone already uses `[^source]`
 * and `[^second]`, and a real document is free to use `[^lindo-1]` too. So the
 * prefix grows until nothing in the source matches it — cheap, and the
 * alternative is an export that silently merges a reader's note into a footnote
 * the author wrote.
 */
function labeller(source: string): (id: number) => string {
  let prefix = "lindo";
  while (source.includes(`[^${prefix}-`)) prefix += "-note";
  let next = 0;
  const seen = new Map<number, string>();
  return (id) => {
    const existing = seen.get(id);
    if (existing) return existing;
    next += 1;
    // Numbered in the order marks appear in the document rather than by id, so
    // the footnotes at the bottom read in the order they are met.
    const name = `${prefix}-${next}`;
    seen.set(id, name);
    return name;
  };
}

/**
 * A note as a single paragraph.
 *
 * A footnote definition continues only while its lines stay indented, and a note
 * is a free-text box the reader may well have pressed Enter in. Flattening is
 * the one option that cannot produce a file whose second paragraph has silently
 * become body text of the document.
 */
function oneParagraph(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/**
 * Applies the insertions and appends what could not go inline.
 *
 * **Back to front.** Every offset was computed against the original string, so
 * inserting at the front first would shift every offset after it by the length
 * of what was inserted — the classic form of this bug, where the first mark is
 * right and each one after it drifts a little further.
 *
 * Every insertion goes in *before* whatever is already at that offset, so at a
 * shared offset the **last** one applied is the one that ends up first in the
 * string. All three tie-breaks below follow from that:
 *
 * - **Closings before openings**, so two adjacent marks read `</mark><mark>`
 *   rather than nesting into each other. Openings sort earlier here, are applied
 *   earlier, and therefore land later.
 * - **Openings, outermost last.** Marks are processed outermost-first, so the
 *   outer one's opening must be applied last to land first. Without this the
 *   inner opening comes out in front and a nested pair's *colours swap* — the
 *   outer phrase wears the inner colour and neither the markup nor the rendered
 *   page looks wrong, which is why it needs a test rather than an eye.
 * - **Closings, outermost first**, which is the mirror of the same rule and is
 *   what the push order already gives.
 */
function assemble(
  source: string,
  edits: { at: number; text: string; opening: boolean }[],
  notes: { label: string; body: string }[],
  stranded: readonly ExportableMark[],
): string {
  const ordered = edits
    .map((edit, seq) => ({ ...edit, seq }))
    .sort(
      (a, b) =>
        b.at - a.at ||
        Number(b.opening) - Number(a.opening) ||
        (a.opening ? b.seq - a.seq : a.seq - b.seq),
    );

  let out = source;
  for (const edit of ordered) {
    out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  }

  const trailing: string[] = [];
  if (notes.length > 0) {
    trailing.push(notes.map((note) => `[^${note.label}]: ${note.body}`).join("\n\n"));
  }
  if (stranded.length > 0) {
    // Not footnote definitions: a definition nothing references is dangling, and
    // renderers disagree about whether to print it at all. A plain section says
    // what these are and shows the words each note was put on, which is the only
    // thing left that connects it to the document.
    trailing.push(
      [
        `## ${STRANDED_HEADING}`,
        "",
        "These were made on words that have since changed, or on a span that",
        "overlaps another highlight, so there is nowhere in the text above to put",
        "them.",
        "",
        stranded
          .map((mark) => {
            const quote = oneParagraph(mark.quote);
            const body = oneParagraph(mark.body);
            return body.length > 0 ? `- “${quote}” — ${body}` : `- “${quote}”`;
          })
          .join("\n"),
      ].join("\n"),
    );
  }

  if (trailing.length === 0) return out;
  // One blank line between the document and what is appended, and never two
  // where the file already ended in a newline.
  return `${out.replace(/\s*$/, "")}\n\n${trailing.join("\n\n")}\n`;
}
