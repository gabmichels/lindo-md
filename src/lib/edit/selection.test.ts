import { describe, expect, it } from "vitest";

import type { BlockMap } from "@/lib/ipc";
import {
  domPositionOf,
  restoreSelection,
  selectionRange,
  sourceOffsetOf,
  textOffsetOf,
} from "./selection";

function article(html: string): HTMLElement {
  const element = document.createElement("article");
  element.className = "doc";
  element.innerHTML = html;
  document.body.replaceChildren(element);
  return element;
}

/** Selects from one text node offset to another and asks what file range that is. */
function rangeOf(blocks: BlockMap[], start: [Node, number], end: [Node, number]) {
  const range = document.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selectionRange(blocks, selection);
}

const plain: BlockMap = {
  sourcepos: "1:1-1:11",
  aligned: true,
  runs: [{ text: "Hello world", sourceStart: 0, sourceEnd: 11 }],
};

describe("textOffsetOf", () => {
  it("counts UTF-16 units into the block's text", () => {
    const root = article(`<p data-sourcepos="1:1-1:11">Hello world</p>`);
    const p = root.querySelector("p")!;
    expect(textOffsetOf(p, p.firstChild!, 6)).toBe(6);
  });

  it("skips text the renderer generated", () => {
    const root = article(
      `<h2 data-sourcepos="1:1-1:5"><a class="anchor" aria-hidden="true"></a>Title</h2>`,
    );
    const h2 = root.querySelector("h2")!;
    const title = h2.lastChild!;
    // The anchor contributes nothing, so "Title" starts at 0, not after it.
    expect(textOffsetOf(h2, title, 0)).toBe(0);
  });

  it("skips an atom's contents", () => {
    const root = article(
      `<p data-sourcepos="1:1-1:20">before <span data-math-style="inline">x^2</span> after</p>`,
    );
    const p = root.querySelector("p")!;
    const after = p.lastChild!;
    // "before " is 7; the maths contributes nothing a caret can sit in.
    expect(textOffsetOf(p, after, 0)).toBe(7);
  });

  it("keeps a nested list's text with its own item", () => {
    const root = article(
      `<li data-sourcepos="1:1-2:9">outer<ul><li data-sourcepos="2:3-2:9">inner</li></ul></li>`,
    );
    const outer = root.querySelector("li")!;
    const inner = root.querySelector<HTMLElement>("li li")!;
    expect(textOffsetOf(outer, outer.firstChild!, 5)).toBe(5);
    // The inner item's text belongs to the inner item, and starts at 0 there.
    expect(textOffsetOf(inner, inner.firstChild!, 3)).toBe(3);
  });
});

describe("sourceOffsetOf", () => {
  it("walks into a run whose source and text advance together", () => {
    expect(sourceOffsetOf(plain, 0)).toBe(0);
    expect(sourceOffsetOf(plain, 6)).toBe(6);
    expect(sourceOffsetOf(plain, 11)).toBe(11);
  });

  // `a **bold** c` — the text reads "a bold c" but the source carries markers
  // that belong to no run at all.
  const emphasised: BlockMap = {
    sourcepos: "1:1-1:12",
    aligned: true,
    runs: [
      { text: "a ", sourceStart: 0, sourceEnd: 2 },
      { text: "bold", sourceStart: 4, sourceEnd: 8 },
      { text: " c", sourceStart: 10, sourceEnd: 12 },
    ],
  };

  it("accounts for markup between runs", () => {
    expect(sourceOffsetOf(emphasised, 7, "start")).toBe(11); // one into " c"
  });

  // A position on a run boundary belongs to both runs, and the `**` between
  // them belongs to neither. Selecting the word "bold" has to land *inside* the
  // markers, or the first toggle produces `****bold****`.
  it("resolves a boundary differently for a start than for an end", () => {
    expect(sourceOffsetOf(emphasised, 2, "start")).toBe(4); // start of "bold"
    expect(sourceOffsetOf(emphasised, 2, "end")).toBe(2); // end of "a "
    expect(sourceOffsetOf(emphasised, 6, "end")).toBe(8); // end of "bold"
    expect(sourceOffsetOf(emphasised, 6, "start")).toBe(10); // start of " c"
  });

  it("selects exactly the emphasised word", () => {
    const root = article(`<p data-sourcepos="1:1-1:12">a <strong>bold</strong> c</p>`);
    const word = root.querySelector("strong")!.firstChild!;
    expect(rangeOf([emphasised], [word, 0], [word, 4])).toEqual({
      start: 4,
      end: 8,
    });
  });

  // A caret cannot sit inside `&amp;`: the source spells one character with
  // five. Landing in the middle would not misplace a caret, it would corrupt
  // the file when a marker was inserted there.
  it("clamps to an end rather than landing inside a non-linear run", () => {
    const block: BlockMap = {
      sourcepos: "1:1-1:5",
      aligned: true,
      runs: [{ text: "&", sourceStart: 0, sourceEnd: 5 }],
    };
    expect(sourceOffsetOf(block, 0)).toBe(0);
    expect(sourceOffsetOf(block, 1)).toBe(5);
  });
});

describe("round trip", () => {
  const emphasised: BlockMap = {
    sourcepos: "1:1-1:12",
    aligned: true,
    runs: [
      { text: "a ", sourceStart: 0, sourceEnd: 2 },
      { text: "bold", sourceStart: 4, sourceEnd: 8 },
      { text: " c", sourceStart: 10, sourceEnd: 12 },
    ],
  };

  // The property the caret depends on: a position that came *out* of the map
  // has to go back *in* to the same place, or every re-render nudges the caret.
  //
  // Checked against both biases because a text offset on a run boundary
  // genuinely describes two source offsets — the end of `a ` and the start of
  // `bold` are the same place on screen, with the `**` in between. Which one you
  // get back is the caller's choice, not an inaccuracy.
  it("puts a source offset back where it came from", () => {
    const root = article(`<p data-sourcepos="1:1-1:12">a <strong>bold</strong> c</p>`);
    const p = root.querySelector("p")!;

    for (const offset of [0, 1, 4, 6, 8, 11, 12]) {
      const position = domPositionOf(root, [emphasised], offset);
      expect(position, `offset ${offset} has no home`).not.toBeNull();

      const textOffset = textOffsetOf(p, position!.node, position!.offset)!;
      const both = [
        sourceOffsetOf(emphasised, textOffset, "start"),
        sourceOffsetOf(emphasised, textOffset, "end"),
      ];
      expect(both, `offset ${offset} did not round-trip`).toContain(offset);
    }
  });

  it("restores a selection over the words it described", () => {
    const root = article(`<p data-sourcepos="1:1-1:12">a <strong>bold</strong> c</p>`);
    expect(restoreSelection(root, [emphasised], { start: 4, end: 8 })).toBe(true);
    expect(window.getSelection()?.toString()).toBe("bold");
  });

  // Markdown strips the whitespace at the end of a line, so typing a space
  // there puts the caret one past anything on screen. Refusing to place it is
  // not neutral: the document has just been replaced wholesale, so a caret that
  // is not put back is a caret at the top of the file.
  it("clamps an offset with no character of its own rather than giving up", () => {
    const root = article(`<p data-sourcepos="1:1-1:12">a <strong>bold</strong> c</p>`);
    const position = domPositionOf(root, [emphasised], 13);
    expect(position).not.toBeNull();
    // The end of the block's text — visually exactly where the reader was.
    expect(position!.node.nodeValue).toBe(" c");
    expect(position!.offset).toBe(2);
  });

  it("clamps an offset far past the end of the document", () => {
    const root = article(`<p data-sourcepos="1:1-1:12">a <strong>bold</strong> c</p>`);
    expect(domPositionOf(root, [emphasised], 5000)).not.toBeNull();
  });

  it("still declines when there is nothing on screen at all", () => {
    const root = article("");
    expect(domPositionOf(root, [], 0)).toBeNull();
  });
});

describe("selectionRange", () => {
  it("resolves a selection inside one block", () => {
    const root = article(`<p data-sourcepos="1:1-1:11">Hello world</p>`);
    const text = root.querySelector("p")!.firstChild!;
    expect(rangeOf([plain], [text, 0], [text, 5])).toEqual({ start: 0, end: 5 });
  });

  // Everything between two blocks is markup the reader did not select — blank
  // lines, bullets, a fence. Wrapping that in `**` would produce something they
  // did not ask for.
  it("refuses a selection spanning two blocks", () => {
    const root = article(
      `<p data-sourcepos="1:1-1:5">first</p><p data-sourcepos="3:1-3:6">second</p>`,
    );
    const [one, two] = [...root.querySelectorAll("p")];
    const blocks: BlockMap[] = [
      {
        sourcepos: "1:1-1:5",
        aligned: true,
        runs: [{ text: "first", sourceStart: 0, sourceEnd: 5 }],
      },
      {
        sourcepos: "3:1-3:6",
        aligned: true,
        runs: [{ text: "second", sourceStart: 7, sourceEnd: 13 }],
      },
    ];
    expect(rangeOf(blocks, [one!.firstChild!, 0], [two!.firstChild!, 3])).toBeNull();
  });

  it("refuses a block with no map entry", () => {
    const root = article(`<p data-sourcepos="9:1-9:5">stale</p>`);
    const text = root.querySelector("p")!.firstChild!;
    expect(rangeOf([plain], [text, 0], [text, 3])).toBeNull();
  });

  it("refuses a selection inside an atom", () => {
    const root = article(
      `<pre class="code-block" data-sourcepos="1:1-3:3"><code>let x = 1;</code></pre>`,
    );
    const text = root.querySelector("code")!.firstChild!;
    expect(rangeOf([plain], [text, 0], [text, 3])).toBeNull();
  });
});
