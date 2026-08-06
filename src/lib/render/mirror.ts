/**
 * Putting a re-rendered document on screen without throwing away the work done
 * to the last one.
 *
 * Every edit sends the whole file to Rust and gets the whole document back, and
 * for a long time the view then did `article.innerHTML = doc.html`. That is one
 * line and it is correct, but it discards every node the enhancement passes had
 * decorated: the highlighted code, the rendered diagrams, the resolved image
 * sources, the KaTeX output. Deleting one word therefore re-ran Shiki over every
 * visible fence, re-ran Mermaid — layout, font measurement, `getBBox` — over
 * every visible diagram, and re-requested every image, before laying the whole
 * document out again from scratch. On a document with a few diagrams that is
 * seconds, for an edit that touched one paragraph.
 *
 * So compare instead. The HTML is a list of top-level blocks; an edit changes
 * one or two of them and leaves the rest byte-identical. Replacing only what
 * changed means an untouched fence keeps its `data-highlighted` marker, an
 * untouched diagram keeps its SVG, and `enhance` finds nothing left to do.
 *
 * The comparison is against the **previous HTML string**, never against the live
 * DOM: by the time the next edit arrives the live nodes no longer resemble what
 * Rust sent — that is the entire point of the enhancement passes. So the string
 * from last time is kept and diffed against the string from this time, and the
 * live children are assumed to correspond to it position for position.
 *
 * That assumption is the one thing that could corrupt a document rather than
 * merely slow it down, so it is checked rather than trusted: if the live child
 * count no longer matches the remembered one — an enhancement pass that adds or
 * removes a top-level node, anything else reaching into the article — the whole
 * body is replaced, exactly as before. Correct and slow beats fast and wrong.
 */

/** What `mirror` remembers between renders: one serialized form per top-level
 *  child of the article, in order. Opaque to callers — hand it back unchanged. */
export type Mirrored = readonly string[];

/**
 * Makes `article` show `html`, reusing whatever nodes it already has.
 *
 * Returns the state to pass in on the next call. Pass `null` for `previous` to
 * force a full replacement — which is what opening a different document is.
 */
export function mirror(article: HTMLElement, html: string, previous: Mirrored | null): Mirrored {
  const template = article.ownerDocument.createElement("template");
  template.innerHTML = html;
  const next = [...template.content.childNodes];
  const nextKeys = next.map(keyOf);

  const live = [...article.childNodes];
  // The remembered list has to describe the children that are actually there,
  // or every index below points at the wrong node. See the module doc.
  if (previous?.length !== live.length) {
    article.replaceChildren(template.content);
    return nextKeys;
  }

  // An edit is a local change: almost everything before it and after it is
  // untouched. Trimming the matching ends is enough to find it, and — unlike a
  // real diff — cannot mistake two identical paragraphs elsewhere in the
  // document for a move.
  let head = 0;
  const limit = Math.min(previous.length, nextKeys.length);
  while (head < limit && same(live[head], previous[head], next[head], nextKeys[head])) head++;

  let tail = 0;
  while (
    tail < limit - head &&
    same(
      live[live.length - 1 - tail],
      previous[previous.length - 1 - tail],
      next[next.length - 1 - tail],
      nextKeys[nextKeys.length - 1 - tail],
    )
  ) {
    tail++;
  }

  const replaced = live.slice(head, live.length - tail);
  const incoming = next.slice(head, next.length - tail);

  if (replaced.length === 0 && incoming.length === 0) return nextKeys;

  // Insert before the first node that survives at the tail, or append when the
  // change runs to the end of the document.
  const anchor = live[live.length - tail] ?? null;
  for (const node of replaced) node.remove();
  if (incoming.length > 0) article.insertBefore(fragmentOf(incoming), anchor);

  return nextKeys;
}

/**
 * Whether the live node can stand in for the incoming one — updating it in place
 * if the only thing that changed is where its text now sits in the file.
 *
 * The plain case is the two serializations being equal. The case worth the extra
 * code is an edit that changes the **number of lines**: deleting a selection that
 * spans a wrapped line, or pressing Return. Every `data-sourcepos` below the edit
 * then shifts by the difference, so every block below it serializes differently
 * and — on a comparison of strings alone — the whole rest of the document is
 * rebuilt. That is the common case, not a corner one, and it would have left this
 * module helping only edits that happen to stay on one line.
 *
 * So a block whose content is identical but whose line numbers have moved has
 * the new numbers written onto it instead. `restamp` refuses unless it can pair
 * every attribute one-to-one, and the caller treats a refusal as "not the same",
 * which falls back to replacing the node.
 */
function same(
  live: Node | undefined,
  previous: string | undefined,
  next: Node | undefined,
  key: string | undefined,
) {
  if (previous === undefined || key === undefined) return false;
  if (previous === key) return true;
  if (!(live instanceof Element) || !(next instanceof Element)) return false;
  if (withoutPositions(previous) !== withoutPositions(key)) return false;
  return restamp(live, next);
}

/**
 * Copies `data-sourcepos` from a freshly rendered block onto the live one.
 *
 * Paired by document order, which is exact **provided the two carry the same
 * attributes in the same places** — so that is checked rather than assumed, and
 * a mismatch aborts before anything is written. Getting this wrong would not
 * merely misdraw something: `data-sourcepos` is what decides which run of the
 * file a keystroke rewrites, so a stale or misplaced one redirects an edit onto
 * text it does not own.
 *
 * The live tree is not the tree Rust sent — Shiki has rewritten the inside of
 * every code block and Mermaid has replaced each diagram with a figure. Neither
 * touches an element carrying a position: comrak puts one on the block, and the
 * fence's body is escaped text with nothing of its own. Mermaid's figure carries
 * the position its `<pre>` had, forwarded for exactly this reason.
 */
function restamp(live: Element, next: Element): boolean {
  const from = [next, ...next.querySelectorAll("[data-sourcepos]")];
  const onto = [live, ...live.querySelectorAll("[data-sourcepos]")];
  if (from.length !== onto.length) return false;

  for (const [index, source] of from.entries()) {
    const target = onto[index];
    if (!target || !fills(target, source)) return false;
    // Both sides must be carrying one, or the pairing has drifted.
    if (target.hasAttribute("data-sourcepos") !== source.hasAttribute("data-sourcepos")) {
      return false;
    }
  }

  for (const [index, source] of from.entries()) {
    const position = source.getAttribute("data-sourcepos");
    if (position !== null) onto[index]?.setAttribute("data-sourcepos", position);
  }
  return true;
}

/**
 * Whether `target` is the live stand-in for the freshly rendered `source`.
 *
 * Normally that means the same element. The exception is the one place an
 * enhancement pass swaps an element for a different one: `renderDiagram`
 * replaces `<pre class="mermaid-src">` with `<figure class="mermaid">` holding
 * the SVG. Recognising that pairing is what keeps a diagram on screen through an
 * edit that shifted the lines beneath it — the single most expensive thing a
 * re-render can be made to redo.
 *
 * Deliberately an exhaustive list of one rather than a loose rule: any other
 * substitution is a pairing this function cannot vouch for, and the caller
 * rebuilds instead.
 */
function fills(target: Element, source: Element): boolean {
  if (target.tagName === source.tagName) return true;
  return target.matches("figure.mermaid") && source.matches("pre.mermaid-src");
}

/** Every `data-sourcepos` removed, so two renders of the same block can be
 *  compared without the line numbers that moved underneath it. Safe as a string
 *  rule: these are serialized attributes, so a `"` inside a value is escaped. */
function withoutPositions(html: string): string {
  return html.replace(/ data-sourcepos="[^"]*"/g, "");
}

/**
 * How a node is compared between renders. `outerHTML` for an element, the text
 * itself for the newlines comrak leaves between blocks.
 *
 * Serializing is not free, but it is a fraction of what re-highlighting one code
 * block costs, and it is the only form that is stable across the two sides:
 * these nodes were parsed from the string they are being compared to.
 */
function keyOf(node: Node): string {
  return node instanceof Element ? node.outerHTML : `#${node.nodeValue ?? ""}`;
}

function fragmentOf(nodes: Node[]): DocumentFragment {
  const fragment = nodes[0]?.ownerDocument?.createDocumentFragment();
  // Unreachable while `nodes` is non-empty, which every caller checks.
  if (!fragment) return document.createDocumentFragment();
  fragment.append(...nodes);
  return fragment;
}
