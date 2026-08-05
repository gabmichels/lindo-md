import { describe, expect, it } from "vitest";

import { applyInput } from "./input";

const at = (offset: number) => ({ start: offset, end: offset });

describe("inserting", () => {
  it("types a character at the caret", () => {
    const edit = applyInput("helo", at(3), "insertText", "l")!;
    expect(edit.source).toBe("hello");
    expect(edit.caret).toBe(4);
    expect(edit.structural).toBe(false);
  });

  it("replaces a selection", () => {
    const edit = applyInput("hello world", { start: 6, end: 11 }, "insertText", "there")!;
    expect(edit.source).toBe("hello there");
    expect(edit.caret).toBe(11);
  });

  // A blank line is what separates two blocks; without it the next line is a
  // lazy continuation of this paragraph rather than a new one.
  it("makes Enter a blank line, and says so", () => {
    const edit = applyInput("one", at(3), "insertParagraph", null)!;
    expect(edit.source).toBe("one\n\n");
    expect(edit.structural).toBe(true);
  });

  it("makes Shift+Enter a hard break", () => {
    const edit = applyInput("one", at(3), "insertLineBreak", null)!;
    expect(edit.source).toBe("one  \n");
    expect(edit.structural).toBe(true);
  });

  it("treats a paste with a newline as structural and one without as not", () => {
    expect(applyInput("ab", at(1), "insertFromPaste", "x")!.structural).toBe(false);
    expect(applyInput("ab", at(1), "insertFromPaste", "x\ny")!.structural).toBe(true);
  });

  it("ignores an input type it does not understand", () => {
    expect(applyInput("ab", at(1), "formatBold", null)).toBeNull();
    expect(applyInput("ab", at(1), "insertText", null)).toBeNull();
  });
});

describe("deleting", () => {
  it("backspaces one character", () => {
    const edit = applyInput("hello", at(5), "deleteContentBackward", null)!;
    expect(edit.source).toBe("hell");
    expect(edit.caret).toBe(4);
  });

  it("deletes forward", () => {
    const edit = applyInput("hello", at(0), "deleteContentForward", null)!;
    expect(edit.source).toBe("ello");
    expect(edit.caret).toBe(0);
  });

  it("deletes a selection whole", () => {
    const edit = applyInput("hello world", { start: 5, end: 11 }, "deleteContentBackward", null)!;
    expect(edit.source).toBe("hello");
    expect(edit.caret).toBe(5);
  });

  // An emoji is a surrogate pair. Deleting one UTF-16 unit would leave half a
  // character in the file — which is not a rendering bug, it is corruption.
  it("deletes a whole emoji rather than half of one", () => {
    const source = "hi 🎉";
    const edit = applyInput(source, at(source.length), "deleteContentBackward", null)!;
    expect(edit.source).toBe("hi ");
  });

  it("deletes backward by word", () => {
    const edit = applyInput("one two three", at(13), "deleteWordBackward", null)!;
    expect(edit.source).toBe("one two ");
  });

  it("deletes forward by word", () => {
    const edit = applyInput("one two three", at(0), "deleteWordForward", null)!;
    expect(edit.source).toBe(" two three");
  });

  it("does nothing at the very start or end", () => {
    expect(applyInput("a", at(0), "deleteContentBackward", null)).toBeNull();
    expect(applyInput("a", at(1), "deleteContentForward", null)).toBeNull();
  });

  it("reports a deletion that crosses a line as structural", () => {
    const edit = applyInput("one\ntwo", at(4), "deleteContentBackward", null)!;
    expect(edit.source).toBe("onetwo");
    expect(edit.structural).toBe(true);
  });
});
