import type { SourceRange } from "@/lib/edit/selection";
import type { Annotation } from "@/lib/ipc";

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
    edits.push({ at: mark.range.start, text: openTag(mark.color), opening: true });

    let closing = "</mark>";
    if (mark.body.trim().length > 0) {
      const name = label(mark.id);
      notes.push({ label: name, body: oneParagraph(mark.body) });
      // The reference goes *after* the closing tag: inside it, the marker would
      // be part of the highlighted phrase and would highlight the little number
      // too.
      closing += `[^${name}]`;
    }
    edits.push({ at: mark.range.end, text: closing, opening: false });
  }

  return {
    markdown: assemble(source, edits, notes, stranded),
    unplaced: stranded.length,
  };
}

interface PlacedMark extends Annotation {
  range: SourceRange;
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
 * At one offset, closings go in before openings, so two adjacent marks read
 * `</mark><mark>` rather than nesting into each other. Applying descending means
 * the array is walked from the end, so the *opening* is emitted first there.
 */
function assemble(
  source: string,
  edits: { at: number; text: string; opening: boolean }[],
  notes: { label: string; body: string }[],
  stranded: readonly ExportableMark[],
): string {
  const ordered = [...edits].sort((a, b) => b.at - a.at || Number(b.opening) - Number(a.opening));

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
