import { describe, expect, it } from "vitest";

import type { BlockMap } from "@/lib/ipc";
import { domRangeOf, highlightName, paintRanges } from "./paint";

function article(html: string): HTMLElement {
  const element = document.createElement("article");
  element.className = "doc";
  element.innerHTML = html;
  document.body.replaceChildren(element);
  return element;
}

/** "Hello world" at file offsets 0-11, then "second para" at 13-24. */
const blocks: BlockMap[] = [
  {
    sourcepos: "1:1-1:11",
    aligned: true,
    runs: [{ text: "Hello world", sourceStart: 0, sourceEnd: 11 }],
  },
  {
    sourcepos: "3:1-3:11",
    aligned: true,
    runs: [{ text: "second para", sourceStart: 13, sourceEnd: 24 }],
  },
];

function twoParagraphs(): HTMLElement {
  return article(
    `<p data-sourcepos="1:1-1:11">Hello world</p><p data-sourcepos="3:1-3:11">second para</p>`,
  );
}

describe("domRangeOf", () => {
  // Tested apart from painting because the panel scrolls to a mark through this
  // and never paints one. The refusals are the part worth pinning: a caller that
  // rebuilt them would get the happy path right and differ on the failures.

  it("places a range over the words the offsets name", () => {
    expect(domRangeOf(twoParagraphs(), blocks, { start: 6, end: 11 })?.toString()).toBe("world");
  });

  it("works without a shared sweep, so a single lookup needs no batch", () => {
    // The panel asks for exactly one range at a time; requiring an index would
    // make every caller build one to throw it away.
    expect(domRangeOf(twoParagraphs(), blocks, { start: 0, end: 5 })?.toString()).toBe("Hello");
  });

  it("refuses a range that lands past everything the block map covers", () => {
    expect(domRangeOf(twoParagraphs(), blocks, { start: 900, end: 950 })).toBeNull();
  });

  it("refuses an empty range rather than returning a point picked by a fallback", () => {
    expect(domRangeOf(twoParagraphs(), blocks, { start: 6, end: 6 })).toBeNull();
  });
});

describe("paintRanges", () => {
  it("turns a source range into a DOM range over the right words", () => {
    const root = twoParagraphs();

    const grouped = paintRanges(root, blocks, [{ range: { start: 6, end: 11 }, color: "yellow" }]);

    const ranges = grouped.get(highlightName("yellow"));
    expect(ranges).toHaveLength(1);
    expect(ranges?.[0]?.toString()).toBe("world");
  });

  it("groups by colour slot, because the registry maps a name to a set", () => {
    const root = twoParagraphs();

    const grouped = paintRanges(root, blocks, [
      { range: { start: 0, end: 5 }, color: "yellow" },
      { range: { start: 6, end: 11 }, color: "green" },
      { range: { start: 13, end: 19 }, color: "yellow" },
    ]);

    expect(grouped.get(highlightName("yellow"))).toHaveLength(2);
    expect(grouped.get(highlightName("green"))).toHaveLength(1);
  });

  it("paints a mark that spans two blocks", () => {
    // The case `annotationRange` exists to allow. The range covers the markup
    // between the paragraphs, which is fine — nothing is being rewritten.
    const root = twoParagraphs();

    const grouped = paintRanges(root, blocks, [{ range: { start: 6, end: 19 }, color: "blue" }]);

    const range = grouped.get(highlightName("blue"))?.[0];
    expect(range?.toString()).toBe("worldsecond");
  });

  it("falls back to the first slot for a colour it does not know", () => {
    // A row written by a later version. The reader marked those words either
    // way, and an invisible highlight reads as data loss.
    const root = twoParagraphs();

    const grouped = paintRanges(root, blocks, [
      { range: { start: 0, end: 5 }, color: "chartreuse" },
    ]);

    expect(grouped.get(highlightName("yellow"))).toHaveLength(1);
  });

  it("drops a mark that would paint nothing rather than painting somewhere else", () => {
    // Both ends land past everything the block map covers, so `domPositionOf`
    // returns its nearest-position fallback and the range collapses. A caret can
    // afford that fallback; a highlight cannot.
    const root = twoParagraphs();

    const grouped = paintRanges(root, blocks, [{ range: { start: 900, end: 950 }, color: "pink" }]);

    expect([...grouped.values()].flat()).toHaveLength(0);
  });

  it("returns nothing for no marks, without touching the document", () => {
    expect(paintRanges(twoParagraphs(), blocks, []).size).toBe(0);
  });

  it("inserts no node into the article, which is what mirror depends on", () => {
    // Wrapping a mark in an element would add a top-level node comrak did not
    // emit, and `mirror` tracks those positionally — every keystroke would fall
    // back to rebuilding the whole document.
    const root = twoParagraphs();
    const before = root.innerHTML;

    paintRanges(root, blocks, [
      { range: { start: 0, end: 5 }, color: "yellow" },
      { range: { start: 6, end: 19 }, color: "green" },
    ]);

    expect(root.innerHTML).toBe(before);
    expect(root.childElementCount).toBe(2);
  });
});
