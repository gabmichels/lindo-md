import type { Theme } from "../theme/schema";
import { mermaidThemeVariables } from "../theme/apply";

/**
 * Renders `<pre class="mermaid-src">` blocks — what `markdown.rs` emits for a
 * ```mermaid fence — into SVG.
 *
 * Mermaid is ~2 MB and is loaded dynamically so Vite code-splits it; a document
 * without diagrams never pays for it. Diagrams are also rendered lazily, as they
 * scroll into view, because a design document with twenty of them would
 * otherwise block the first paint.
 */

type MermaidApi = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidApi> | null = null;
let appliedThemeId: string | null = null;
let counter = 0;

async function getMermaid(theme: Theme): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidPromise;

  // Mermaid bakes colors into the SVG rather than reading CSS variables, so the
  // palette has to be re-applied whenever the document theme changes — and every
  // diagram re-rendered, which `enhance.ts` handles by clearing `data-rendered`.
  if (appliedThemeId !== theme.id) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // `securityLevel: "strict"` does not cover this. It leaves `htmlLabels` on,
      // and Mermaid's DOMPurify pass allows `img`/`src` — reasonable for a diagram
      // library, wrong for a viewer whose whole claim is that it never phones home.
      // `stripRemoteRefs` below is the guarantee; this is the cheaper first pass.
      dompurifyConfig: {
        FORBID_TAGS: ["style", "img", "image", "use"],
        FORBID_ATTR: ["src", "srcset", "href", "xlink:href"],
      },
      theme: "base",
      themeVariables: mermaidThemeVariables(theme),
      // The heading face, not the body face: diagram labels are short strings in
      // boxes, where a sans reads better than the prose serif — and the boxes are
      // sized from a text measurement, which is far more predictable with one.
      fontFamily: theme.typography.headingFont,
    });
    appliedThemeId = theme.id;
  }

  // Mermaid measures every label to size the box around it. If the font is
  // still loading, it measures a fallback face and lays the diagram out for the
  // wrong metrics — boxes come out too narrow and every label is clipped.
  await fontReady(theme.typography.headingFont, diagramFontSize(theme));

  return mermaid;
}

/** Resolves once the family is usable for measurement, or immediately if the
 *  browser cannot tell us — a late diagram beats no diagram. */
async function fontReady(family: string, size: number): Promise<void> {
  if (!("fonts" in document)) return;
  try {
    await document.fonts.load(`${size}px ${family}`);
    await document.fonts.ready;
  } catch {
    // An unloadable family is not fatal; Mermaid falls back and still renders.
  }
}

/**
 * Removes everything in a rendered diagram that would fetch from the network.
 *
 * A ```mermaid fence is document content, so its text is as untrusted as the rest
 * of the Markdown — but it does not travel the same road. `markdown.rs` hands the
 * fence body over HTML-escaped, so ammonia never sees the markup inside it, and
 * Mermaid then renders that text into SVG in the webview. With `htmlLabels` on —
 * which is Mermaid's default even at `securityLevel: "strict"` — a label like
 * `A["<img src='https://…'>"]` becomes a real `<img>` in the output, and Mermaid's
 * own DOMPurify pass allows `img`/`src` because for a diagram library they are
 * ordinary. `resolveImages` never sees it either: `enhance()` runs that once, up
 * front, before any diagram exists.
 *
 * The result was a second egress channel with nothing on it, which a CDP session
 * confirmed by watching the request leave. This is unconditional rather than
 * keyed on `blockRemoteImages`: a diagram is a drawing of the reader's own text,
 * and there is no version of it that should reach a server.
 */
export function stripRemoteRefs(root: HTMLElement): void {
  // `src` on <img>, and both spellings of href on SVG <image>/<use> — each of
  // these fetches on its own the moment the node is attached.
  //
  // An allowlist, not `isExternal`. A rendered diagram has exactly two legitimate
  // reference forms: `#id` for its own markers and gradients, and `data:` for
  // anything Mermaid inlines. Everything else goes, which means the rule does not
  // depend on enumerating the ways a URL can point off-device — `isExternal` does
  // not count `//host/path` as external, and that alone let a protocol-relative
  // source through the first version of this.
  for (const node of root.querySelectorAll("img, image, use")) {
    for (const attribute of ["src", "srcset", "href", "xlink:href"]) {
      const value = node.getAttribute(attribute)?.trim();
      if (!value) continue;
      const local = value.startsWith("#") || value.toLowerCase().startsWith("data:");
      if (!local) node.removeAttribute(attribute);
    }
  }

  // `url(...)` in a style attribute or an injected <style> is the same fetch by
  // another route. Mermaid always emits a <style> block, so this is not theoretical.
  //
  // Compared rather than tested first: `REMOTE_URL` is a global regex, and `.test()`
  // on one leaves `lastIndex` where it stopped, so a following `.replace()` starts
  // partway through the string and misses the match it just found.
  for (const node of root.querySelectorAll("[style]")) {
    const style = node.getAttribute("style") ?? "";
    const cleaned = style.replace(REMOTE_URL, "none");
    if (cleaned !== style) node.setAttribute("style", cleaned);
  }
  for (const style of root.querySelectorAll("style")) {
    const css = style.textContent;
    const cleaned = css.replace(REMOTE_URL, "none");
    if (cleaned !== css) style.textContent = cleaned;
  }
}

/** Any `url(...)` that is not an internal fragment or a data URI. Same allowlist
 *  reasoning as the attributes above: enumerate what is allowed, not what is not.
 *  Loose about quoting and whitespace, because this is a filter and not a parser. */
const REMOTE_URL = /url\(\s*['"]?\s*(?!#|data:)[^)]*\)/gi;

/**
 * Renders one diagram in place. A diagram that fails to parse shows its source
 * and the parser's message instead of an empty gap: a broken diagram in someone
 * else's document is information, not a failure of the viewer.
 */
export async function renderDiagram(block: HTMLElement, theme: Theme): Promise<void> {
  const source = block.dataset.source ?? block.textContent;
  block.dataset.source = source;
  // Carried onto the figure below. A rendered diagram is never edited — it is in
  // `ATOM_SELECTOR`, so no caret goes inside it and no block map entry resolves
  // to it — but `lib/render/mirror.ts` pairs the live document against a fresh
  // render by these attributes, and a diagram that has lost its own is a diagram
  // that gets re-rendered from scratch every time an edit above it moves a line.
  const sourcepos = block.getAttribute("data-sourcepos");

  try {
    const mermaid = await getMermaid(theme);
    // Rendered into an attached container, not Mermaid's default detached one.
    // Dagre measures label text through the live DOM; with nothing attached the
    // measurement fails silently and flowcharts come out with a nonsense square
    // viewBox (a 200px graph inside a 2100x2100 box).
    const { svg } = await mermaid.render(`mermaid-${counter++}`, source, measuringHost(theme));

    const figure = document.createElement("figure");
    figure.className = "mermaid";
    figure.innerHTML = svg;
    // While `figure` is still detached — nothing in a detached tree loads a
    // subresource, so this runs before any request can be made. Once
    // `replaceWith` attaches it, removing the attribute would be a race against a
    // fetch that has already been queued.
    stripRemoteRefs(figure);
    figure.dataset.source = source;
    figure.dataset.rendered = theme.id;
    if (sourcepos !== null) figure.setAttribute("data-sourcepos", sourcepos);
    // Diagrams are frequently wider than the measure; the overlay in
    // `DiagramViewer` opens on click, and the figure scrolls in the meantime.
    figure.tabIndex = 0;
    figure.setAttribute("role", "img");

    block.replaceWith(figure);
    // Must happen after insertion: the fix below measures the real geometry,
    // which only exists once the SVG is in the rendered document.
    normalizeViewBox(figure);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = document.createElement("figure");
    failed.className = "mermaid mermaid-error";
    failed.dataset.source = source;
    failed.dataset.rendered = theme.id;
    if (sourcepos !== null) failed.setAttribute("data-sourcepos", sourcepos);

    const caption = document.createElement("figcaption");
    caption.textContent = `Diagram could not be rendered — ${firstLine(message)}`;

    const pre = document.createElement("pre");
    pre.className = "code-block";
    const code = document.createElement("code");
    code.textContent = source;
    pre.append(code);

    failed.append(caption, pre);
    block.replaceWith(failed);
  }
}

/**
 * Rewrites the SVG's viewBox from the geometry it actually contains.
 *
 * Mermaid's own sizing is not reliable here: a flowchart routinely comes back
 * with a square viewBox several times the size of the graph inside it (a 200px
 * diagram declared as 2100x2100), which renders as a postage stamp adrift in a
 * huge empty box. Measuring the drawing and sizing the box to it is correct for
 * every diagram type and independent of which of Mermaid's layout engines
 * produced it.
 *
 * Does nothing if the geometry cannot be measured — an unrendered or empty SVG
 * keeps whatever Mermaid decided.
 */
function normalizeViewBox(figure: HTMLElement): void {
  const svg = figure.querySelector("svg");
  const content = svg?.querySelector("g");
  if (!svg || !content) return;

  let box: DOMRect;
  try {
    box = content.getBBox();
  } catch {
    return;
  }
  if (box.width <= 0 || box.height <= 0) return;

  const PAD = 10;
  const width = box.width + PAD * 2;
  const height = box.height + PAD * 2;

  svg.setAttribute("viewBox", `${box.x - PAD} ${box.y - PAD} ${width} ${height}`);
  svg.setAttribute("width", "100%");
  // A fixed height attribute would fight the aspect ratio the viewBox implies.
  svg.removeAttribute("height");
  // Never scale a diagram up past its natural size — an upscaled flowchart is
  // blurry text and oversized boxes.
  svg.style.maxWidth = `${Math.ceil(width)}px`;
  svg.style.height = "auto";
}

/**
 * A live, laid-out element for Mermaid to measure text in.
 *
 * Positioned off-screen rather than hidden: `display: none` or
 * `visibility: hidden` would zero out every text measurement, which is the same
 * failure as not attaching it at all. One host is reused for every diagram.
 */
function measuringHost(theme: Theme): HTMLElement {
  const host =
    document.getElementById(HOST_ID) ?? document.body.appendChild(document.createElement("div"));

  host.id = HOST_ID;
  host.setAttribute("aria-hidden", "true");

  // Two things matter here, and both caused clipped labels before they were
  // fixed:
  //
  //  1. Off-screen, but fully laid out. `display: none`, `visibility: hidden`,
  //     `height: 0` and `overflow: hidden` each zero out the child text
  //     measurements Mermaid depends on.
  //  2. The same type context the finished diagram renders in. Mermaid measures
  //     each label in a div that inherits from this host, then draws it in the
  //     SVG at the theme's diagram size. Left to inherit the app chrome's 13px,
  //     it measures ~30% narrow and every box is drawn too small for its text.
  host.style.cssText = [
    "position:absolute",
    "left:-100000px",
    "top:0",
    "width:1200px",
    "pointer-events:none",
    `font-family:${theme.typography.headingFont}`,
    `font-size:${diagramFontSize(theme)}px`,
    "line-height:1.5",
  ].join(";");

  return host;
}

/** Kept in step with `fontSize` in `mermaidThemeVariables`, which is what the
 *  rendered SVG uses. The two must agree or measurement and drawing disagree. */
function diagramFontSize(theme: Theme): number {
  return Math.round(theme.typography.baseSize * 0.8);
}

const HOST_ID = "lindo-md-mermaid-host";

/** Mermaid's parse errors are multi-line with an ASCII pointer; the first line
 *  is the part a reader can act on. */
function firstLine(message: string): string {
  // `||`, not `??`: a first line that trims to the empty string has to fall back too,
  // and `??` only catches null and undefined.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- "" must fall back
  return message.split("\n")[0]?.trim() || "unknown error";
}
