import { describe, expect, it } from "vitest";

import { filterAnnotations, inDocumentOrder, matches, oneLine } from "./list";
import type { Annotation } from "@/lib/ipc";
import type { SourceRange } from "@/lib/edit/selection";

/** A stored annotation with everything the list logic never reads left at a
 *  constant, so each test states only the field it is about. */
function annotation(fields: Partial<Annotation> & { id: number }): Annotation {
  return {
    path: "C:/notes/one.md",
    color: "yellow",
    body: "",
    quote: "some words",
    prefix: "",
    suffix: "",
    startOffset: 0,
    endOffset: 10,
    anchoredHash: "h1",
    createdAt: 1_000,
    updatedAt: 1_000,
    ...fields,
  };
}

/** The resolved shape the document list takes: a row plus where it is now. */
function placed(fields: Partial<Annotation> & { id: number }, range: SourceRange | null) {
  return { ...annotation(fields), range };
}

describe("inDocumentOrder", () => {
  it("orders placed marks by where they are on the page, not by when they were made", () => {
    const late = placed({ id: 1, createdAt: 9_000 }, { start: 10, end: 20 });
    const early = placed({ id: 2, createdAt: 1_000 }, { start: 0, end: 5 });

    expect(inDocumentOrder([late, early]).map((mark) => mark.id)).toEqual([2, 1]);
  });

  it("breaks a tie on where a mark ends, so nested marks have a stable order", () => {
    const outer = placed({ id: 1 }, { start: 4, end: 40 });
    const inner = placed({ id: 2 }, { start: 4, end: 9 });

    expect(inDocumentOrder([outer, inner]).map((mark) => mark.id)).toEqual([2, 1]);
  });

  it("puts orphans last and never interleaves them", () => {
    // The orphan was made between the two placed marks, so anything ordering by
    // creation would put it in the middle — where it would claim a position on
    // the page that it does not have.
    const orphan = placed({ id: 2, createdAt: 5_000 }, null);
    const first = placed({ id: 1, createdAt: 1_000 }, { start: 0, end: 5 });
    const last = placed({ id: 3, createdAt: 9_000 }, { start: 50, end: 60 });

    expect(inDocumentOrder([orphan, first, last]).map((mark) => mark.id)).toEqual([1, 3, 2]);
  });

  it("keeps orphans in the order they were made", () => {
    const newer = placed({ id: 1, createdAt: 9_000 }, null);
    const older = placed({ id: 2, createdAt: 1_000 }, null);

    expect(inDocumentOrder([newer, older]).map((mark) => mark.id)).toEqual([2, 1]);
  });

  it("does not sort the array it was given", () => {
    // It is React state: sorting in place mutates a value another render holds,
    // and the bug that causes shows up somewhere else entirely.
    const marks = [
      placed({ id: 1 }, { start: 90, end: 95 }),
      placed({ id: 2 }, { start: 0, end: 5 }),
    ];

    inDocumentOrder(marks);

    expect(marks.map((mark) => mark.id)).toEqual([1, 2]);
  });
});

describe("matches", () => {
  const row = annotation({
    id: 1,
    path: "C:/notes/Roadmap.md",
    body: "Ask about the timeline",
    quote: "shipping in the autumn",
  });

  it("finds a mark by its note", () => {
    expect(matches(row, "timeline")).toBe(true);
  });

  it("finds a mark by the words it was put on", () => {
    expect(matches(row, "autumn")).toBe(true);
  });

  it("does not search the path at all", () => {
    // Every row in the list is from the same file, so a file name that matched
    // would match all of them — typing the name of what you are reading would
    // look like a filter that had stopped working.
    expect(matches(row, "roadmap")).toBe(false);
    expect(matches(row, "notes")).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    expect(matches(row, "  TIMELINE  ")).toBe(true);
  });

  it("keeps everything when there is no query", () => {
    expect(matches(row, "")).toBe(true);
    expect(matches(row, "   ")).toBe(true);
  });

  it("refuses a query that is in neither", () => {
    expect(matches(row, "kangaroo")).toBe(false);
  });
});

describe("filterAnnotations", () => {
  const rows = [
    annotation({ id: 1, body: "about badgers" }),
    annotation({ id: 2, body: "about otters" }),
  ];

  it("keeps only the marks that answer the query", () => {
    expect(filterAnnotations(rows, "otters").map((row) => row.id)).toEqual([2]);
  });

  it("returns everything for an empty query", () => {
    expect(filterAnnotations(rows, "  ").map((row) => row.id)).toEqual([1, 2]);
  });

  it("has nothing to show for a document with no marks", () => {
    expect(filterAnnotations([], "otters")).toEqual([]);
  });

  it("hands back a copy, so a caller can hold it across a render", () => {
    const filtered = filterAnnotations(rows, "");

    expect(filtered).not.toBe(rows);
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
  });
});

describe("oneLine", () => {
  it("leaves a short quote as it is", () => {
    expect(oneLine("a short quote")).toBe("a short quote");
  });

  it("collapses the newlines a multi-paragraph mark carries", () => {
    expect(oneLine("first line\n\n   second line  ")).toBe("first line second line");
  });

  it("cuts at a word boundary rather than mid-word", () => {
    const cut = oneLine("alpha bravo charlie delta echo foxtrot", 20);

    expect(cut).toBe("alpha bravo charlie…");
  });

  it("cuts mid-word when the last boundary is too far back to use", () => {
    // A single long token — a URL, a hash — has no boundary within reach, and
    // returning almost nothing would be worse than an obvious cut.
    const cut = oneLine(`${"x".repeat(40)} tail`, 20);

    expect(cut).toBe(`${"x".repeat(20)}…`);
  });

  it("counts the limit after collapsing, not before", () => {
    expect(oneLine(`alpha${" ".repeat(50)}bravo`, 20)).toBe("alpha bravo");
  });
});
