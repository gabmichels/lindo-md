import { describe, expect, it } from "vitest";

import { annotatedMarkdown, type ExportableMark } from "./annotated";
import type { Annotation } from "@/lib/ipc";

/** A mark over the first occurrence of `quote`, as the document view would hand
 *  one over: resolved against this source, with its stored fields filled in. */
function mark(
  source: string,
  quote: string,
  fields: Partial<Annotation> & { id: number },
): ExportableMark {
  const start = source.indexOf(quote);
  if (start < 0) throw new Error(`"${quote}" is not in the source`);
  return {
    path: "C:/notes/one.md",
    color: "yellow",
    body: "",
    quote,
    prefix: "",
    suffix: "",
    startOffset: start,
    endOffset: start + quote.length,
    anchoredHash: "h1",
    createdAt: 1_000,
    updatedAt: 1_000,
    ...fields,
    range: { start, end: start + quote.length },
  };
}

/** An orphan: listed, still carrying its quote, but with nowhere to go. */
function orphan(fields: Partial<Annotation> & { id: number }): ExportableMark {
  return { ...mark("x", "x", { ...fields, id: fields.id }), range: null };
}

const SOURCE = "The quick brown fox jumps over the lazy dog.\n";

describe("annotatedMarkdown", () => {
  it("wraps a highlight in a mark element carrying its colour", () => {
    const { markdown } = annotatedMarkdown(SOURCE, [mark(SOURCE, "brown fox", { id: 1 })]);

    expect(markdown).toBe(
      'The quick <mark class="lindo-yellow">brown fox</mark> jumps over the lazy dog.\n',
    );
  });

  it("leaves a document with no marks exactly as it was", () => {
    expect(annotatedMarkdown(SOURCE, []).markdown).toBe(SOURCE);
  });

  it("places every mark where it belongs, not drifting further with each one", () => {
    // The bug this is really about: offsets are all computed against the
    // original string, so inserting front-to-back shifts everything after the
    // first insertion. The last mark is the one that shows it.
    const { markdown } = annotatedMarkdown(SOURCE, [
      mark(SOURCE, "quick", { id: 1 }),
      mark(SOURCE, "fox", { id: 2, color: "green" }),
      mark(SOURCE, "lazy dog", { id: 3, color: "blue" }),
    ]);

    expect(markdown).toBe(
      'The <mark class="lindo-yellow">quick</mark> brown ' +
        '<mark class="lindo-green">fox</mark> jumps over the ' +
        '<mark class="lindo-blue">lazy dog</mark>.\n',
    );
  });

  it("keeps two adjacent marks side by side rather than nesting them", () => {
    const source = "abcdef";
    const { markdown } = annotatedMarkdown(source, [
      { ...mark(source, "abc", { id: 1 }), range: { start: 0, end: 3 } },
      { ...mark(source, "def", { id: 2, color: "green" }), range: { start: 3, end: 6 } },
    ]);

    expect(markdown).toBe(
      '<mark class="lindo-yellow">abc</mark><mark class="lindo-green">def</mark>',
    );
  });

  it("nests a mark that sits inside another", () => {
    // Legal HTML and legible output, so there is no reason to refuse it.
    const { markdown } = annotatedMarkdown(SOURCE, [
      mark(SOURCE, "quick brown fox", { id: 1 }),
      mark(SOURCE, "brown", { id: 2, color: "green" }),
    ]);

    expect(markdown).toContain(
      '<mark class="lindo-yellow">quick <mark class="lindo-green">brown</mark> fox</mark>',
    );
  });

  it("strands a mark that crosses another rather than writing markup nothing can parse", () => {
    // `<mark>a<mark>b</mark>c` has no closing order any parser agrees on, and
    // getting it wrong corrupts every line after it.
    const result = annotatedMarkdown(SOURCE, [
      mark(SOURCE, "quick brown", { id: 1 }),
      mark(SOURCE, "brown fox", { id: 2, color: "green" }),
    ]);

    expect(result.markdown).toContain('<mark class="lindo-yellow">quick brown</mark>');
    expect(result.markdown).not.toContain("lindo-green");
    expect(result.unplaced).toBe(1);
    // Not lost, though — it is named at the bottom with the words it was on.
    expect(result.markdown).toContain("Notes without a place in the text");
    expect(result.markdown).toContain("brown fox");
  });

  it("turns a note into a footnote, referenced after the highlight", () => {
    const { markdown } = annotatedMarkdown(SOURCE, [
      mark(SOURCE, "brown fox", { id: 1, body: "Check this against the 2024 figures." }),
    ]);

    expect(markdown).toContain('<mark class="lindo-yellow">brown fox</mark>[^lindo-1] jumps');
    expect(markdown).toContain("[^lindo-1]: Check this against the 2024 figures.");
  });

  it("puts the reference outside the mark, so the little number is not highlighted", () => {
    const { markdown } = annotatedMarkdown(SOURCE, [
      mark(SOURCE, "brown fox", { id: 1, body: "note" }),
    ]);

    expect(markdown).not.toContain("[^lindo-1]</mark>");
  });

  it("numbers footnotes in the order they are met in the document", () => {
    const { markdown } = annotatedMarkdown(SOURCE, [
      mark(SOURCE, "lazy dog", { id: 7, body: "second" }),
      mark(SOURCE, "quick", { id: 9, body: "first" }),
    ]);

    expect(markdown).toContain('<mark class="lindo-yellow">quick</mark>[^lindo-1]');
    expect(markdown).toContain('<mark class="lindo-yellow">lazy dog</mark>[^lindo-2]');
    expect(markdown.indexOf("[^lindo-1]: first")).toBeLessThan(
      markdown.indexOf("[^lindo-2]: second"),
    );
  });

  it("gives a bare highlight no footnote at all", () => {
    const { markdown } = annotatedMarkdown(SOURCE, [mark(SOURCE, "brown fox", { id: 1 })]);

    expect(markdown).not.toContain("[^");
  });

  it("treats a whitespace-only note as no note", () => {
    const { markdown } = annotatedMarkdown(SOURCE, [
      mark(SOURCE, "brown fox", { id: 1, body: "   \n  " }),
    ]);

    expect(markdown).not.toContain("[^");
  });

  it("moves out of the way of a document that already uses the label", () => {
    // A real document is free to have written `[^lindo-1]` itself, and merging a
    // reader's note into the author's footnote would be silent and wrong.
    const source = "Claim[^lindo-1] here.\n\n[^lindo-1]: The author's own note.\n";
    const { markdown } = annotatedMarkdown(source, [
      mark(source, "Claim", { id: 1, body: "mine" }),
    ]);

    expect(markdown).toContain("[^lindo-note-1]: mine");
    expect(markdown).toContain("[^lindo-1]: The author's own note.");
  });

  it("flattens a multi-line note, which a footnote definition cannot carry", () => {
    // A definition continues only while its lines stay indented; a second
    // paragraph would silently become body text of the document.
    const { markdown } = annotatedMarkdown(SOURCE, [
      mark(SOURCE, "brown fox", { id: 1, body: "first line\n\nsecond line" }),
    ]);

    expect(markdown).toContain("[^lindo-1]: first line second line");
  });

  it("lists an orphan at the end rather than dropping it", () => {
    const result = annotatedMarkdown(SOURCE, [
      orphan({ id: 1, quote: "a sentence that was reworded", body: "worth keeping" }),
    ]);

    expect(result.unplaced).toBe(1);
    expect(result.markdown).toContain("Notes without a place in the text");
    expect(result.markdown).toContain("a sentence that was reworded");
    expect(result.markdown).toContain("worth keeping");
  });

  it("lists an orphan with no note by its quote alone", () => {
    const result = annotatedMarkdown(SOURCE, [orphan({ id: 1, quote: "gone words" })]);

    expect(result.markdown).toContain("“gone words”");
    expect(result.markdown).not.toContain("—");
  });

  it("adds no trailing section when everything found a home", () => {
    const result = annotatedMarkdown(SOURCE, [mark(SOURCE, "brown fox", { id: 1 })]);

    expect(result.unplaced).toBe(0);
    expect(result.markdown).not.toContain("Notes without a place");
  });

  it("refuses a range that runs past the end of the document", () => {
    // Offsets that describe a longer file than this one cannot be trusted to
    // describe any part of it.
    const result = annotatedMarkdown(SOURCE, [
      { ...mark(SOURCE, "brown fox", { id: 1 }), range: { start: 4, end: 9_000 } },
    ]);

    expect(result.unplaced).toBe(1);
    expect(result.markdown).not.toContain("<mark");
  });

  it("refuses an empty range", () => {
    const result = annotatedMarkdown(SOURCE, [
      { ...mark(SOURCE, "brown fox", { id: 1 }), range: { start: 4, end: 4 } },
    ]);

    expect(result.unplaced).toBe(1);
    expect(result.markdown).not.toContain("<mark");
  });

  it("writes a bare mark for a colour slot it does not recognise", () => {
    // A row from a later build. The words were marked either way, and the slot
    // name must never reach an attribute uninspected.
    const { markdown } = annotatedMarkdown(SOURCE, [
      mark(SOURCE, "brown fox", { id: 1, color: 'x" onload="alert(1)' }),
    ]);

    expect(markdown).toContain("<mark>brown fox</mark>");
    expect(markdown).not.toContain("onload");
  });

  it("counts in UTF-16 code units, the same unit the anchors are stored in", () => {
    const source = "🎉 alpha beta gamma";
    const { markdown } = annotatedMarkdown(source, [mark(source, "beta", { id: 1 })]);

    expect(markdown).toBe('🎉 alpha <mark class="lindo-yellow">beta</mark> gamma');
  });

  it("separates the appended notes from a document that did not end in a newline", () => {
    const { markdown } = annotatedMarkdown("No trailing newline", [
      {
        ...mark("No trailing newline", "No", { id: 1, body: "note" }),
        range: { start: 0, end: 2 },
      },
    ]);

    expect(markdown).toContain("newline\n\n[^lindo-1]: note\n");
  });
});
