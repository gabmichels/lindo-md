import { describe, expect, it } from "vitest";

import { byDocument, filterGroups, inDocumentOrder, matches, oneLine, pinCurrent } from "./list";
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

describe("byDocument", () => {
  it("groups by path and names each group after the file", () => {
    const groups = byDocument([
      annotation({ id: 1, path: "C:/notes/one.md" }),
      annotation({ id: 2, path: "C:/notes/two.md" }),
      annotation({ id: 3, path: "C:/notes/one.md" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.name).sort()).toEqual(["one.md", "two.md"]);
    expect(
      groups
        .flatMap((group) => group.annotations)
        .map((row) => row.id)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  it("orders groups by their most recently touched mark, not alphabetically", () => {
    const groups = byDocument([
      annotation({ id: 1, path: "C:/notes/aardvark.md", updatedAt: 1_000 }),
      annotation({ id: 2, path: "C:/notes/zebra.md", updatedAt: 9_000 }),
    ]);

    expect(groups.map((group) => group.name)).toEqual(["zebra.md", "aardvark.md"]);
  });

  it("takes a group's recency from its newest mark, not from the one listed first", () => {
    const groups = byDocument([
      annotation({ id: 1, path: "C:/notes/one.md", updatedAt: 2_000 }),
      annotation({ id: 2, path: "C:/notes/one.md", updatedAt: 8_000 }),
      annotation({ id: 3, path: "C:/notes/two.md", updatedAt: 5_000 }),
    ]);

    expect(groups.map((group) => group.name)).toEqual(["one.md", "two.md"]);
    expect(groups[0]!.touchedAt).toBe(8_000);
  });

  it("orders marks within a group by their stored offsets", () => {
    const groups = byDocument([
      annotation({ id: 1, startOffset: 500 }),
      annotation({ id: 2, startOffset: 10 }),
    ]);

    expect(groups[0]!.annotations.map((row) => row.id)).toEqual([2, 1]);
  });

  it("reads a name off either separator, since paths come from two platforms", () => {
    const groups = byDocument([
      annotation({ id: 1, path: "C:\\notes\\windows.md" }),
      annotation({ id: 2, path: "/home/reader/posix.md" }),
    ]);

    expect(groups.map((group) => group.name).sort()).toEqual(["posix.md", "windows.md"]);
  });

  it("has nothing to say about nothing", () => {
    expect(byDocument([])).toEqual([]);
  });
});

describe("pinCurrent", () => {
  const groups = byDocument([
    annotation({ id: 1, path: "C:/notes/newest.md", updatedAt: 9_000 }),
    annotation({ id: 2, path: "C:/notes/middle.md", updatedAt: 5_000 }),
    annotation({ id: 3, path: "C:/notes/oldest.md", updatedAt: 1_000 }),
  ]);

  it("brings the document being read to the front", () => {
    expect(pinCurrent(groups, "C:/notes/oldest.md").map((group) => group.name)).toEqual([
      "oldest.md",
      "newest.md",
      "middle.md",
    ]);
  });

  it("leaves the recency order of everything else alone", () => {
    // One group moving, not a second sort — the rest of the list still answers
    // "what have I been flagging".
    const pinned = pinCurrent(groups, "C:/notes/middle.md");

    expect(pinned.slice(1).map((group) => group.name)).toEqual(["newest.md", "oldest.md"]);
  });

  it("changes nothing when the document is already first", () => {
    expect(pinCurrent(groups, "C:/notes/newest.md").map((group) => group.name)).toEqual(
      groups.map((group) => group.name),
    );
  });

  it("changes nothing for a document with no marks, or no document at all", () => {
    const names = groups.map((group) => group.name);

    expect(pinCurrent(groups, "C:/notes/unmarked.md").map((group) => group.name)).toEqual(names);
    expect(pinCurrent(groups, null).map((group) => group.name)).toEqual(names);
  });

  it("does not reorder the array it was given", () => {
    const names = groups.map((group) => group.name);

    pinCurrent(groups, "C:/notes/oldest.md");

    expect(groups.map((group) => group.name)).toEqual(names);
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

  it("finds a mark by the file it is in", () => {
    expect(matches(row, "roadmap")).toBe(true);
  });

  it("does not search the folders above the file", () => {
    // Otherwise every mark in a folder matches its own folder's name, which
    // makes a query for a project name return everything in it.
    expect(matches(row, "notes")).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    expect(matches(row, "  TIMELINE  ")).toBe(true);
  });

  it("keeps everything when there is no query", () => {
    expect(matches(row, "")).toBe(true);
    expect(matches(row, "   ")).toBe(true);
  });

  it("refuses a query that is in none of the three", () => {
    expect(matches(row, "kangaroo")).toBe(false);
  });
});

describe("filterGroups", () => {
  const groups = byDocument([
    annotation({ id: 1, path: "C:/notes/one.md", body: "about badgers" }),
    annotation({ id: 2, path: "C:/notes/one.md", body: "about otters" }),
    annotation({ id: 3, path: "C:/notes/two.md", body: "about badgers" }),
  ]);

  it("keeps only the marks that answer the query", () => {
    const filtered = filterGroups(groups, "otters");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.annotations.map((row) => row.id)).toEqual([2]);
  });

  it("drops a group left with nothing rather than showing an empty heading", () => {
    expect(
      filterGroups(groups, "badgers")
        .map((group) => group.name)
        .sort(),
    ).toEqual(["one.md", "two.md"]);
    expect(filterGroups(groups, "otters").map((group) => group.name)).toEqual(["one.md"]);
  });

  it("returns everything for an empty query, without touching the groups given", () => {
    const filtered = filterGroups(groups, "  ");

    expect(filtered).toEqual([...groups]);
    expect(groups[0]!.annotations).toHaveLength(2);
  });

  it("leaves the groups it was given alone", () => {
    filterGroups(groups, "otters");

    expect(groups[0]!.annotations.map((row) => row.id)).toEqual([1, 2]);
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
