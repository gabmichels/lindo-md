import { describe, expect, it } from "vitest";

import { applyFormat, type FormatCommand } from "./format";

/** Applies a command to whatever `|…|` marks out, and returns the result with
 *  the new selection marked the same way — so a test reads as before/after. */
function format(marked: string, command: FormatCommand): string {
  const start = marked.indexOf("|");
  const end = marked.indexOf("|", start + 1) - 1;
  const source = marked.replace(/\|/g, "");
  const edit = applyFormat(source, { start, end }, command);
  return (
    edit.source.slice(0, edit.selection.start) +
    "|" +
    edit.source.slice(edit.selection.start, edit.selection.end) +
    "|" +
    edit.source.slice(edit.selection.end)
  );
}

describe("wrapping commands", () => {
  it("wraps a selection", () => {
    expect(format("make |this| bold", "bold")).toBe("make **|this|** bold");
    expect(format("make |this| italic", "italic")).toBe("make _|this|_ italic");
    expect(format("make |this| code", "code")).toBe("make `|this|` code");
    expect(format("make |this| gone", "strikethrough")).toBe("make ~~|this|~~ gone");
  });

  // The toggle is what makes this a formatting menu rather than a snippet
  // inserter: choosing Bold twice has to leave the document as it started.
  it("unwraps when the markers sit just outside the selection", () => {
    expect(format("make **|this|** plain", "bold")).toBe("make |this| plain");
  });

  it("unwraps when the markers are inside the selection", () => {
    expect(format("make |**this**| plain", "bold")).toBe("make |this| plain");
  });

  it("round-trips", () => {
    const once = format("a |word| here", "bold");
    expect(once).toBe("a **|word|** here");
    expect(format(once, "bold")).toBe("a |word| here");
  });

  it("does not mistake a marker for a wrapper when the selection is too short", () => {
    // Selecting the `**` itself must not be read as an empty wrapped string.
    expect(format("a |**| b", "bold")).toBe("a **|**|** b");
  });
});

describe("line commands", () => {
  it("adds a prefix to the line the selection is on", () => {
    expect(format("|Title|\n", "heading2")).toBe("## |Title|\n");
    expect(format("|Item|\n", "bullet")).toBe("- |Item|\n");
    expect(format("|Item|\n", "task")).toBe("- [ ] |Item|\n");
    expect(format("|Quoted|\n", "quote")).toBe("> |Quoted|\n");
  });

  it("removes the prefix when it is already there", () => {
    expect(format("## |Title|\n", "heading2")).toBe("|Title|\n");
    expect(format("> |Quoted|\n", "quote")).toBe("|Quoted|\n");
  });

  // Otherwise choosing Bullet on a heading produces `## - Item`.
  it("replaces whichever prefix the line already had", () => {
    expect(format("## |Title|\n", "bullet")).toBe("- |Title|\n");
    expect(format("- |Item|\n", "heading3")).toBe("### |Item|\n");
    expect(format("- [ ] |Task|\n", "bullet")).toBe("- |Task|\n");
  });

  // `2. ` has to count as the same list `1. ` would create, or toggling a
  // numbered list only works on its first item.
  it("recognises any number as the numbered list it would create", () => {
    expect(format("2. |Second|\n", "numbered")).toBe("|Second|\n");
    expect(format("3) |Third|\n", "numbered")).toBe("|Third|\n");
  });

  it("covers every line the selection touches", () => {
    const source = "one\ntwo\nthree\n";
    const edit = applyFormat(source, { start: 1, end: 9 }, "bullet");
    expect(edit.source).toBe("- one\n- two\n- three\n");
  });

  // With a mixed selection the reader means "make these all bullets"; toggling
  // each line on its own would scramble them.
  it("adds rather than removes when only some lines have the prefix", () => {
    const source = "- one\ntwo\n";
    const edit = applyFormat(source, { start: 0, end: 9 }, "bullet");
    expect(edit.source).toBe("- one\n- two\n");
  });

  it("leaves blank lines alone", () => {
    const source = "one\n\ntwo\n";
    const edit = applyFormat(source, { start: 0, end: 8 }, "quote");
    expect(edit.source).toBe("> one\n\n> two\n");
  });

  it("keeps indentation in front of the prefix", () => {
    const source = "  nested\n";
    const edit = applyFormat(source, { start: 2, end: 8 }, "bullet");
    expect(edit.source).toBe("  - nested\n");
  });

  it("leaves the rest of the document untouched", () => {
    const source = "# Doc\n\nintro\n\ntarget\n\ntail\n";
    const edit = applyFormat(source, { start: 15, end: 21 }, "quote");
    expect(edit.source).toBe("# Doc\n\nintro\n\n> target\n\ntail\n");
  });
});
