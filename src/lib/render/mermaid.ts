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
      // `securityLevel: "strict"` does not cover this: Mermaid's DOMPurify pass
      // allows `img`/`src` — reasonable for a diagram library, wrong for a viewer
      // whose whole claim is that it never phones home. `stripRemoteRefs` below
      // is the guarantee; this is the cheaper first pass.
      dompurifyConfig: {
        FORBID_TAGS: ["style", "img", "image", "use"],
        FORBID_ATTR: ["src", "srcset", "href", "xlink:href"],
      },
      // Labels as SVG `<text>`, not as HTML in a `foreignObject`. This is a
      // *layout* decision first: Mermaid measures an HTML label by putting it in
      // the DOM and reading `getBoundingClientRect`, then seeds the element with
      // `calculateTextWidth(label) + 100` — and an ER entity, which is nothing
      // but labels, ends up sized from those inflated boxes rather than from its
      // text. The same nine-entity diagram measures 10,287px wide with HTML
      // labels and 1,852px without, which is the difference between a wall of
      // unreadable bars and a diagram that fits the page.
      //
      // It also closes the `<img>` route structurally rather than by filtering:
      // with no foreignObject there is no HTML in the output for a label like
      // `A["<img src='https://…'>"]` to become. `stripRemoteRefs` stays anyway —
      // it is the thing that has to hold if this line is ever reverted.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
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
 * The adopted copy of each diagram's stylesheet, by the id it is scoped to.
 *
 * Mermaid emits a `<style>` inside the SVG and puts *everything* there — fills,
 * strokes, and the `text-align: center` that puts a label in the middle of its
 * box. In the packaged app that element is inert, and the symptom is not an
 * error but a diagram drawn in SVG's defaults: black boxes, no borders, labels
 * against the left edge.
 *
 * The cause is CSP, and it is not the policy in `tauri.conf.json`. Tauri appends
 * a nonce to `style-src` when it builds, and a nonce in a directive makes CSP
 * *ignore* `'unsafe-inline'` for that directive — so the configured
 * `style-src 'self' 'unsafe-inline'` stops covering any `<style>` the app
 * inserts at runtime. Nothing in `vite dev` does that, which is why this
 * survived review and shipped: the diagram is correct in every development run.
 *
 * A constructed stylesheet is the way through. CSP governs style *elements* and
 * style *attributes*; rules installed through CSSOM by script that is already
 * trusted are not inline styles and are not blocked. Widening the policy would
 * work too, and was the first instinct — but it re-permits every inline
 * `<style>` in the app to buy back one, and this costs a Map.
 *
 * Deliberately additive: the inert `<style>` stays in the figure, because
 * `export/html.ts` serializes the canvas and an exported file has no CSP and no
 * adopted sheets. Removing it here would fix the window and quietly break every
 * diagram in every exported document.
 */
const adoptedSheets = new Map<string, CSSStyleSheet>();

/** Whether this engine has constructed stylesheets. jsdom does not, so the
 *  render tests exercise everything around this and skip the adoption itself. */
function canAdopt(): boolean {
  return (
    typeof CSSStyleSheet === "function" &&
    "replaceSync" in CSSStyleSheet.prototype &&
    "adoptedStyleSheets" in Document.prototype
  );
}

/**
 * Re-installs a rendered diagram's own CSS somewhere the CSP will honour it.
 *
 * Keyed by the SVG's id because that is what every rule Mermaid writes is
 * scoped to (`#mermaid-4 .node rect { … }`), which is also what keeps an adopted
 * sheet from reaching anything outside its own diagram.
 */
export function adoptDiagramStyles(figure: HTMLElement): void {
  const id = figure.querySelector("svg")?.id;
  if (!id || !canAdopt()) return;

  const css = [...figure.querySelectorAll("style")]
    .map((style) => style.textContent)
    .join("\n")
    .trim();
  if (!css) return;

  let sheet = adoptedSheets.get(id);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    adoptedSheets.set(id, sheet);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  // Re-rendered rather than new — a theme change re-renders every diagram, and
  // Mermaid bakes the palette into the CSS, so the same id gets fresh rules.
  sheet.replaceSync(css);
  pruneDiagramStyles();
}

/**
 * Drops the sheets whose diagram has left the document.
 *
 * Every render mints a new id, and a document being edited re-renders often, so
 * without this the adopted list grows for as long as the app is open. Looked up
 * by id rather than tracked by hand because a figure can leave in more ways than
 * this module can see — `mirror` replaces blocks an edit touched, a tab closes,
 * a view unmounts.
 */
export function pruneDiagramStyles(): void {
  const stale = [...adoptedSheets].filter(([id]) => !document.getElementById(id));
  if (!stale.length) return;

  const dropped = new Set(stale.map(([, sheet]) => sheet));
  for (const [id] of stale) adoptedSheets.delete(id);
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => !dropped.has(sheet));
}

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
    // Must happen after insertion, both of them: `normalizeViewBox` measures the
    // real geometry and `adoptDiagramStyles` prunes by looking the SVG up by id,
    // and neither exists until the figure is in the document.
    normalizeViewBox(figure);
    adoptDiagramStyles(figure);
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
export function normalizeViewBox(figure: HTMLElement): void {
  const svg = figure.querySelector("svg");
  if (!svg) return;

  const box = drawnBox(svg);
  if (!box) return;

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
 * Everything the SVG actually draws, as one box.
 *
 * The SVG's own `getBBox` is the union of its children, which is the number
 * wanted here. This used to measure `svg.querySelector("g")` — the *first*
 * group — and that is only the whole drawing for the diagram types that wrap
 * themselves in a single root group. A sequence diagram emits one top-level
 * group per actor and message, so the viewBox was rewritten to the bounds of one
 * participant box and the rest of the diagram was cropped away: three actors and
 * four messages rendered as a lone rectangle. Flowcharts have a root group and
 * were always correct, which is how it went unnoticed.
 *
 * Falls back to the first group when the union is unmeasurable, and gives up
 * rather than guessing when neither can be measured — an unrendered or hidden
 * SVG (a background tab measures as zero) keeps whatever Mermaid decided.
 */
function drawnBox(svg: SVGSVGElement): DOMRect | null {
  const candidates: (SVGGraphicsElement | null)[] = [svg, svg.querySelector("g")];
  for (const element of candidates) {
    if (!element) continue;
    try {
      const box = element.getBBox();
      if (box.width > 0 && box.height > 0) return box;
    } catch {
      // jsdom has no layout and throws here; the next candidate cannot do better.
      return null;
    }
  }
  return null;
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
  //  3. Shrink-to-fit, not a fixed width. The host used to be `width: 1200px`,
  //     and a *block* label measured inside it reports the host's width rather
  //     than its own text's — which is how an ER entity whose longest comment is
  //     four words came out 1600px wide, and a nine-entity diagram 10,000px
  //     wide. Diagram types drawing their labels as SVG `<text>` were never
  //     affected, which is why this survived: it is only visible where Mermaid
  //     uses HTML labels, and ER is the type that uses them for every cell.
  //     `max-width` keeps a genuinely long label wrapping rather than running
  //     off into one endless line.
  host.style.cssText = [
    "position:absolute",
    "left:-100000px",
    "top:0",
    "width:max-content",
    "max-width:1200px",
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
