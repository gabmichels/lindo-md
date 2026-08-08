import { describe, expect, it } from "vitest";

import { fuzzyMatch } from "@/lib/palette/match";

/** The score of `query` against `text`, or `-Infinity` when it does not match. */
function scoreOf(query: string, text: string): number {
  return fuzzyMatch(query, text)?.score ?? -Infinity;
}

/** Which candidate a palette would put first. */
function best(query: string, candidates: string[]): string | undefined {
  return candidates
    .map((text) => ({ text, score: scoreOf(query, text) }))
    .filter((candidate) => candidate.score > -Infinity)
    .sort((a, b) => b.score - a.score)[0]?.text;
}

describe("fuzzyMatch", () => {
  it("matches a subsequence, not only a substring", () => {
    expect(fuzzyMatch("renmer", "src/lib/render/mermaid.ts")).not.toBeNull();
  });

  it("refuses characters that are not in order", () => {
    expect(fuzzyMatch("dcba", "abcd")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("TABSTRIP", "TabStrip.tsx")).not.toBeNull();
    expect(fuzzyMatch("tabstrip", "TabStrip.tsx")).not.toBeNull();
  });

  it("matches everything when nothing is typed, without marking anything", () => {
    expect(fuzzyMatch("", "anything at all")).toEqual({ score: 0, ranges: [] });
  });

  it("reports contiguous matched characters as one range", () => {
    expect(fuzzyMatch("mer", "mermaid.ts")?.ranges).toEqual([[0, 3]]);
  });

  it("reports a split match as several ranges, in order", () => {
    expect(fuzzyMatch("ab", "a-b")?.ranges).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  /**
   * Why the scan tries every beginning rather than only the first. Anchored at
   * the `m` of `mock`, a greedy pass ends at `render`'s `r` and spreads `mer`
   * across the path — while the exact word sits further along, unreached.
   */
  it("finds the tight match later in the string, not the first one available", () => {
    const match = fuzzyMatch("mer", "src/mock/render/mermaid.ts");
    expect(match?.ranges).toEqual([[16, 19]]);
  });

  describe("ranking", () => {
    it("prefers a name match over the same characters spread out", () => {
      expect(best("mermaid", ["src/lib/render/mermaid.ts", "my-extremely-random-file.md"])).toBe(
        "src/lib/render/mermaid.ts",
      );
    });

    it("prefers a match at a word boundary", () => {
      expect(best("rt", ["render/theme.ts", "assorted.md"])).toBe("render/theme.ts");
    });

    it("prefers the shorter of two candidates that both contain the query", () => {
      expect(best("notes", ["notes.md", "release-notes-draft-v2.md"])).toBe("notes.md");
    });

    it("prefers a match at the start", () => {
      expect(best("read", ["readme.md", "already-read.md"])).toBe("readme.md");
    });

    it("prefers a run of adjacent characters over the same count scattered", () => {
      expect(scoreOf("abc", "abcxxxxxx")).toBeGreaterThan(scoreOf("abc", "axbxcxxxx"));
    });
  });

  describe("long candidates", () => {
    // A deeply nested path is distinctive at its end, and scanning every
    // character of every candidate is a cost paid on each keystroke.
    const deep = `${"nested/".repeat(60)}mermaid.ts`;

    it("still matches on the tail", () => {
      expect(fuzzyMatch("mermaid", deep)).not.toBeNull();
    });

    it("reports ranges as indices into the whole string", () => {
      const match = fuzzyMatch("mermaid", deep);
      const [range] = match?.ranges ?? [];
      expect(range && deep.slice(range[0], range[1])).toBe("mermaid");
    });
  });
});
