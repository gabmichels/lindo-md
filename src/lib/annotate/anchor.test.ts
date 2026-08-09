import { describe, expect, it } from "vitest";

import { CONTEXT, createAnchor, overlaps, resolveAnchor, type Anchor } from "./anchor";

/** An anchor over the first occurrence of `quote`, as the app would make one. */
function anchorOn(source: string, quote: string, hash = "h1"): Anchor {
  const start = source.indexOf(quote);
  const made = createAnchor(source, { start, end: start + quote.length }, hash);
  if (!made) throw new Error(`no anchor for ${quote}`);
  return made;
}

describe("createAnchor", () => {
  it("records the quote with context either side", () => {
    const source = "The quick brown fox jumps over the lazy dog.";
    const anchor = anchorOn(source, "brown fox");

    expect(anchor.quote).toBe("brown fox");
    expect(anchor.prefix).toBe("The quick ");
    expect(anchor.suffix).toBe(" jumps over the lazy dog.");
    expect(anchor.startOffset).toBe(10);
    expect(anchor.endOffset).toBe(19);
  });

  it("keeps at most CONTEXT characters of context", () => {
    const source = `${"a".repeat(100)}TARGET${"b".repeat(100)}`;
    const anchor = anchorOn(source, "TARGET");

    expect(anchor.prefix).toHaveLength(CONTEXT);
    expect(anchor.suffix).toHaveLength(CONTEXT);
  });

  it("does not run off either end of the document", () => {
    const anchor = anchorOn("hi", "hi");

    expect(anchor.prefix).toBe("");
    expect(anchor.suffix).toBe("");
  });

  it("refuses an empty range", () => {
    // Nothing to search for means the mark could never be re-found — it would
    // fail by pointing somewhere plausible and wrong rather than by failing.
    expect(createAnchor("some text", { start: 4, end: 4 }, "h1")).toBeNull();
  });

  it("indexes UTF-16 code units, not code points or bytes", () => {
    // "🎉" is one code point, two UTF-16 units, and four UTF-8 bytes. Only the
    // middle answer indexes the JavaScript string the webview actually holds.
    const source = "🎉 alpha beta";
    const anchor = anchorOn(source, "beta");

    expect(anchor.startOffset).toBe(9);
    expect(source.slice(anchor.startOffset, anchor.endOffset)).toBe("beta");
  });
});

describe("resolveAnchor", () => {
  const source = "The quick brown fox jumps over the lazy dog.";

  it("trusts the offsets while the document is provably unchanged", () => {
    const anchor = anchorOn(source, "brown fox");

    expect(resolveAnchor(source, "h1", anchor)).toEqual({
      status: "exact",
      range: { start: 10, end: 19 },
    });
  });

  it("re-finds the quote after an edit above it", () => {
    const anchor = anchorOn(source, "brown fox");
    const edited = `A new opening sentence. ${source}`;

    const resolved = resolveAnchor(edited, "h2", anchor);

    expect(resolved.status).toBe("moved");
    if (resolved.status !== "moved") return;
    expect(edited.slice(resolved.range.start, resolved.range.end)).toBe("brown fox");
  });

  it("is idempotent: a re-anchored mark resolves exactly next time", () => {
    const anchor = anchorOn(source, "brown fox");
    const edited = `A new opening sentence. ${source}`;
    const moved = resolveAnchor(edited, "h2", anchor);
    if (moved.status !== "moved") throw new Error("expected a move");

    // What the app writes back after a move — new offsets, new hash.
    const rewritten: Anchor = {
      ...anchor,
      startOffset: moved.range.start,
      endOffset: moved.range.end,
      anchoredHash: "h2",
    };

    expect(resolveAnchor(edited, "h2", rewritten)).toEqual({
      status: "exact",
      range: moved.range,
    });
  });

  it("orphans a mark whose text is gone", () => {
    const anchor = anchorOn(source, "brown fox");

    // Kept and still listed — it is the reader's note — but not painted.
    expect(resolveAnchor("An entirely different document.", "h2", anchor)).toEqual({
      status: "orphaned",
    });
  });

  it("uses the surrounding context to pick between repetitions", () => {
    const twice = "Chapter one. See the note below. Chapter two. See the note below.";
    const second = twice.lastIndexOf("See the note below.");
    const anchor = createAnchor(
      twice,
      { start: second, end: second + "See the note below.".length },
      "h1",
    );
    if (!anchor) throw new Error("no anchor");

    const edited = twice.replace("Chapter one.", "Chapter one, rewritten at some length.");
    const resolved = resolveAnchor(edited, "h2", anchor);

    expect(resolved.status).toBe("moved");
    if (resolved.status !== "moved") return;
    // The one after "Chapter two", not the first occurrence.
    expect(resolved.range.start).toBe(edited.lastIndexOf("See the note below."));
  });

  it("orphans rather than guessing when two candidates are indistinguishable", () => {
    // The same phrase in the same context twice, equally far from where the mark
    // used to be. Picking one would put a reader's note on a sentence they never
    // marked, which is worse than showing no highlight.
    // Constructed to be exactly symmetric: the two occurrences have identical
    // context and sit the same distance either side of the stale offset, so
    // neither the context score nor the proximity tie-break can separate them.
    const repeated = "bb TODO bb TODO bb";
    const anchor: Anchor = {
      quote: "TODO",
      prefix: "bb ",
      suffix: " bb",
      startOffset: 7,
      endOffset: 11,
      anchoredHash: "h1",
    };

    expect(resolveAnchor(repeated, "h2", anchor)).toEqual({ status: "orphaned" });
  });

  it("searches rather than trusting a hash whose offsets do not spell the quote", () => {
    // Should be impossible, so it means a row is already wrong. Trusting the
    // numbers would paint the wrong words; searching finds the right ones.
    const anchor: Anchor = {
      ...anchorOn(source, "brown fox"),
      startOffset: 0,
      endOffset: 9,
    };

    expect(resolveAnchor(source, "h1", anchor)).toEqual({
      status: "moved",
      range: { start: 10, end: 19 },
    });
  });

  it("survives a CRLF file, because the source it indexes has already been normalized", () => {
    // `text::decode` collapses every line ending before anything above it sees
    // the document, so there is one newline character per line here and the
    // offsets do not drift by one per preceding line.
    const normalized = "line one\nline two\nthe marked words\nline four";
    const anchor = anchorOn(normalized, "the marked words");

    expect(normalized.slice(anchor.startOffset, anchor.endOffset)).toBe("the marked words");
    expect(resolveAnchor(normalized, "h1", anchor).status).toBe("exact");
  });
});

describe("overlaps", () => {
  const mark = { start: 10, end: 20 };

  it("finds a selection that covers part of a mark", () => {
    expect(overlaps(mark, { start: 15, end: 25 })).toBe(true);
    expect(overlaps(mark, { start: 5, end: 12 })).toBe(true);
    expect(overlaps(mark, { start: 0, end: 30 })).toBe(true);
  });

  it("does not count touching as overlapping", () => {
    // A highlight ending exactly where the next begins is a different mark, so
    // treating a shared boundary as an overlap would remove one the reader is
    // not inside.
    expect(overlaps(mark, { start: 20, end: 24 })).toBe(false);
    expect(overlaps(mark, { start: 6, end: 10 })).toBe(false);
  });

  it("puts a caret inside a mark only when it is strictly within", () => {
    expect(overlaps(mark, { start: 15, end: 15 })).toBe(true);
    expect(overlaps(mark, { start: 10, end: 10 })).toBe(false);
    expect(overlaps(mark, { start: 20, end: 20 })).toBe(false);
  });

  it("never matches an orphan, which is nowhere in the document", () => {
    expect(overlaps(null, { start: 0, end: 100 })).toBe(false);
  });
});
