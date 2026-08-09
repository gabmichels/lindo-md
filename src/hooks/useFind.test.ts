import { describe, expect, it } from "vitest";

import { findRanges } from "./useFind";

function root(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

describe("findRanges", () => {
  it("finds text in the document", () => {
    expect(findRanges(root("<p>a draft paragraph</p>"), "draft")).toHaveLength(1);
  });

  /**
   * The Custom Highlight API paints nothing inside a collapsed `<details>`, and
   * `scrollIntoView` on a range there moves nowhere — so a match that is counted
   * but never shown reads as the find bar being broken: "1 of 3" with Enter
   * doing nothing. Reaching this needed a disclosure inside the scroller, which
   * the frontmatter block was the first of; a `<details>` written by a document
   * has always had the same shape.
   */
  it("ignores text inside a collapsed disclosure", () => {
    const collapsed = root(
      `<details><summary>Frontmatter</summary><pre>status: draft</pre></details>`,
    );
    expect(findRanges(collapsed, "draft")).toHaveLength(0);
    // The summary is on screen, so it is still searchable.
    expect(findRanges(collapsed, "Frontmatter")).toHaveLength(1);
  });

  /** A summary is only on screen if its *own* disclosure is the collapsed one. */
  it("ignores a summary nested inside another collapsed disclosure", () => {
    const nested = root(
      `<details><summary>Outer</summary><details open><summary>Inner</summary><p>body</p></details></details>`,
    );
    expect(findRanges(nested, "Outer")).toHaveLength(1);
    expect(findRanges(nested, "Inner")).toHaveLength(0);
    expect(findRanges(nested, "body")).toHaveLength(0);
  });

  it("searches an expanded disclosure normally", () => {
    const open = root(
      `<details open><summary>Frontmatter</summary><pre>status: draft</pre></details>`,
    );
    expect(findRanges(open, "draft")).toHaveLength(1);
  });

  it("skips the copy buttons injected into code blocks", () => {
    expect(
      findRanges(root(`<pre><button class="code-copy">Copy</button>x</pre>`), "Copy"),
    ).toHaveLength(0);
  });
});
