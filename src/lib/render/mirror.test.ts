import { describe, expect, it } from "vitest";

import { mirror, type Mirrored } from "./mirror";

/** Comrak separates top-level blocks with a newline, and those newlines are text
 *  nodes in the article — the diff has to survive them. */
function paragraphs(...texts: string[]): string {
  return texts.map((text) => `<p>${text}</p>`).join("\n");
}

function article(html: string): { element: HTMLElement; state: Mirrored } {
  const element = document.createElement("article");
  return { element, state: mirror(element, html, null) };
}

describe("mirror", () => {
  it("renders the document when there is nothing to compare against", () => {
    const { element } = article(paragraphs("one", "two"));
    expect(element.querySelectorAll("p")).toHaveLength(2);
    expect(element.textContent).toContain("one");
  });

  it("keeps the nodes of blocks the edit did not touch", () => {
    const { element, state } = article(paragraphs("one", "two", "three"));
    const [first, second, third] = [...element.querySelectorAll("p")];

    mirror(element, paragraphs("one", "TWO", "three"), state);

    const after = [...element.querySelectorAll("p")];
    // The point of the whole module: an untouched block is the *same element*,
    // so whatever Shiki, Mermaid or KaTeX did to it is still there.
    expect(after[0]).toBe(first);
    expect(after[2]).toBe(third);
    expect(after[1]).not.toBe(second);
    expect(after[1]?.textContent).toBe("TWO");
  });

  it("survives an enhancement pass having rewritten the node it kept", () => {
    const { element, state } = article(
      `<pre class="code-block"><code>x</code></pre>\n<p>after</p>`,
    );
    const block = element.querySelector("pre");
    // What `highlightBlock` does: the live DOM stops resembling what Rust sent.
    block!.dataset.highlighted = "github-dark";
    block!.querySelector("code")!.innerHTML = "<span>x</span>";

    mirror(element, `<pre class="code-block"><code>x</code></pre>\n<p>edited</p>`, state);

    expect(element.querySelector("pre")).toBe(block);
    expect(block?.dataset.highlighted).toBe("github-dark");
  });

  it("inserts a block without disturbing the ones around it", () => {
    const { element, state } = article(paragraphs("one", "three"));
    const [first, last] = [...element.querySelectorAll("p")];

    mirror(element, paragraphs("one", "two", "three"), state);

    const after = [...element.querySelectorAll("p")];
    expect(after.map((p) => p.textContent)).toEqual(["one", "two", "three"]);
    expect(after[0]).toBe(first);
    expect(after[2]).toBe(last);
  });

  it("removes a block without disturbing the ones around it", () => {
    const { element, state } = article(paragraphs("one", "two", "three"));
    const [first, , last] = [...element.querySelectorAll("p")];

    mirror(element, paragraphs("one", "three"), state);

    const after = [...element.querySelectorAll("p")];
    expect(after.map((p) => p.textContent)).toEqual(["one", "three"]);
    expect(after[0]).toBe(first);
    expect(after[1]).toBe(last);
  });

  it("replaces a block at the end of the document", () => {
    const { element, state } = article(paragraphs("one", "two"));
    mirror(element, paragraphs("one", "two!"), state);
    expect([...element.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["one", "two!"]);
  });

  it("does nothing when the document is unchanged", () => {
    const html = paragraphs("one", "two");
    const { element, state } = article(html);
    const before = [...element.childNodes];

    mirror(element, html, state);

    expect([...element.childNodes]).toEqual(before);
  });

  it("rebuilds from scratch when something else has changed the article", () => {
    const { element, state } = article(paragraphs("one", "two"));
    // A pass that adds a top-level node would put every index below out by one,
    // so the remembered list is no longer a description of what is on screen.
    element.append(document.createElement("div"));

    mirror(element, paragraphs("one", "TWO"), state);

    expect([...element.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["one", "TWO"]);
    expect(element.querySelector("div")).toBeNull();
  });

  describe("when an edit moves the lines below it", () => {
    it("keeps the blocks and writes the new positions onto them", () => {
      const { element, state } = article(
        `<p data-sourcepos="1:1-2:9">one</p>\n<p data-sourcepos="4:1-4:5">two</p>`,
      );
      const [, second] = [...element.querySelectorAll("p")];

      // Deleting across a wrapped line: block one loses a line and everything
      // below it shifts up, so nothing below serializes the same.
      mirror(
        element,
        `<p data-sourcepos="1:1-1:9">one</p>\n<p data-sourcepos="3:1-3:5">two</p>`,
        state,
      );

      const after = [...element.querySelectorAll("p")];
      expect(after[1]).toBe(second);
      expect(after[1]?.getAttribute("data-sourcepos")).toBe("3:1-3:5");
    });

    it("keeps a rendered diagram, which is the expensive one", () => {
      const { element, state } = article(
        `<p data-sourcepos="1:1-2:9">one</p>\n<pre class="mermaid-src" data-sourcepos="4:1-6:3">graph</pre>`,
      );
      // What `renderDiagram` leaves behind, position and all.
      const figure = document.createElement("figure");
      figure.className = "mermaid";
      figure.dataset.rendered = "ink";
      figure.setAttribute("data-sourcepos", "4:1-6:3");
      element.querySelector("pre")?.replaceWith(figure);

      mirror(
        element,
        `<p data-sourcepos="1:1-1:9">one</p>\n<pre class="mermaid-src" data-sourcepos="3:1-5:3">graph</pre>`,
        state,
      );

      expect(element.querySelector("figure")).toBe(figure);
      expect(figure.getAttribute("data-sourcepos")).toBe("3:1-5:3");
      // The re-render must not have reintroduced an unrendered diagram beside it.
      expect(element.querySelector("pre.mermaid-src")).toBeNull();
    });

    it("rebuilds rather than guess when the positions cannot be paired", () => {
      const { element, state } = article(
        `<p data-sourcepos="1:1-2:9">one <em data-sourcepos="2:1-2:5">two</em></p>`,
      );
      const paragraph = element.querySelector("p");
      // A live tree that has lost a carrier: pairing by order would put the
      // paragraph's position onto the emphasis, and an edit would then rewrite
      // the wrong run of the file.
      paragraph?.querySelector("em")?.removeAttribute("data-sourcepos");

      mirror(
        element,
        `<p data-sourcepos="1:1-1:9">one <em data-sourcepos="1:1-1:5">two</em></p>`,
        state,
      );

      expect(element.querySelector("p")).not.toBe(paragraph);
      expect(element.querySelector("p")?.getAttribute("data-sourcepos")).toBe("1:1-1:9");
    });

    it("still replaces a block whose text changed as well", () => {
      const { element, state } = article(
        `<p data-sourcepos="1:1-2:9">one</p>\n<p data-sourcepos="4:1-4:5">two</p>`,
      );
      mirror(
        element,
        `<p data-sourcepos="1:1-1:9">one</p>\n<p data-sourcepos="3:1-3:7">two!</p>`,
        state,
      );
      expect([...element.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["one", "two!"]);
    });
  });

  it("returns state that describes the document it just built", () => {
    const { element, state } = article(paragraphs("one", "two"));
    const next = mirror(element, paragraphs("one", "two", "three"), state);
    // Round-tripping the returned state has to be a no-op, or the next edit
    // diffs against the wrong document.
    const nodes = [...element.childNodes];
    mirror(element, paragraphs("one", "two", "three"), next);
    expect([...element.childNodes]).toEqual(nodes);
  });
});
