import { describe, expect, it } from "vitest";

import { startLine, toggleTask } from "./tasks";

describe("toggleTask", () => {
  it("ticks and unticks", () => {
    const source = "- [ ] todo\n";
    const ticked = toggleTask(source, 1);
    expect(ticked).toBe("- [x] todo\n");
    expect(toggleTask(ticked!, 1)).toBe("- [ ] todo\n");
  });

  it("changes only the line it was given", () => {
    const source = "- [ ] one\n- [ ] two\n- [ ] three\n";
    expect(toggleTask(source, 2)).toBe("- [ ] one\n- [x] two\n- [ ] three\n");
  });

  // "Which line is this checkbox on" is the only part of this that can break,
  // and nesting is where it would.
  it("handles nested items", () => {
    const source = "- [ ] outer\n  - [ ] inner\n    - [ ] deeper\n";
    expect(toggleTask(source, 3)).toBe(
      "- [ ] outer\n  - [ ] inner\n    - [x] deeper\n",
    );
  });

  it("handles items inside a blockquote", () => {
    expect(toggleTask("> - [ ] quoted\n", 1)).toBe("> - [x] quoted\n");
    expect(toggleTask(">> - [x] deeper\n", 1)).toBe(">> - [ ] deeper\n");
  });

  it("accepts every bullet GFM does", () => {
    expect(toggleTask("* [ ] star\n", 1)).toBe("* [x] star\n");
    expect(toggleTask("+ [ ] plus\n", 1)).toBe("+ [x] plus\n");
    expect(toggleTask("1. [ ] ordered\n", 1)).toBe("1. [x] ordered\n");
    expect(toggleTask("1) [ ] paren\n", 1)).toBe("1) [x] paren\n");
  });

  it("treats an uppercase X as ticked", () => {
    expect(toggleTask("- [X] done\n", 1)).toBe("- [ ] done\n");
  });

  it("leaves text that only looks like a task alone", () => {
    expect(toggleTask("A sentence with [ ] brackets\n", 1)).toBeNull();
    expect(toggleTask("- an ordinary item\n", 1)).toBeNull();
    expect(toggleTask("", 1)).toBeNull();
  });

  it("refuses a line that is not there", () => {
    expect(toggleTask("- [ ] only\n", 9)).toBeNull();
    expect(toggleTask("- [ ] only\n", 0)).toBeNull();
  });

  it("preserves the rest of the document byte for byte", () => {
    const source = "# Title\n\nIntro.\n\n- [ ] task\n\n## After\n\nTail.\n";
    const edited = toggleTask(source, 5)!;
    expect(edited).toBe(source.replace("- [ ] task", "- [x] task"));
    expect(edited.length).toBe(source.length);
  });
});

describe("startLine", () => {
  it("reads the line out of a sourcepos attribute", () => {
    expect(startLine("12:1-14:37")).toBe(12);
    expect(startLine("1:1-1:7")).toBe(1);
  });

  it("returns null for anything it cannot read", () => {
    expect(startLine(null)).toBeNull();
    expect(startLine(undefined)).toBeNull();
    expect(startLine("")).toBeNull();
    expect(startLine("nonsense")).toBeNull();
  });
});
