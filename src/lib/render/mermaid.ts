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
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  const mermaid = await mermaidPromise;

  // Mermaid bakes colors into the SVG rather than reading CSS variables, so the
  // palette has to be re-applied whenever the document theme changes — and every
  // diagram re-rendered, which `enhance.ts` handles by clearing `data-rendered`.
  if (appliedThemeId !== theme.id) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
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
 * Renders one diagram in place. A diagram that fails to parse shows its source
 * and the parser's message instead of an empty gap: a broken diagram in someone
 * else's document is information, not a failure of the viewer.
 */
export async function renderDiagram(
  block: HTMLElement,
  theme: Theme,
): Promise<void> {
  const source = block.dataset.source ?? block.textContent ?? "";
  block.dataset.source = source;

  try {
    const mermaid = await getMermaid(theme);
    // Rendered into an attached container, not Mermaid's default detached one.
    // Dagre measures label text through the live DOM; with nothing attached the
    // measurement fails silently and flowcharts come out with a nonsense square
    // viewBox (a 200px graph inside a 2100x2100 box).
    const { svg } = await mermaid.render(
      `mermaid-${counter++}`,
      source,
      measuringHost(theme),
    );

    const figure = document.createElement("figure");
    figure.className = "mermaid";
    figure.innerHTML = svg;
    figure.dataset.source = source;
    figure.dataset.rendered = theme.id;
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

  svg.setAttribute(
    "viewBox",
    `${box.x - PAD} ${box.y - PAD} ${width} ${height}`,
  );
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
    (document.getElementById(HOST_ID) as HTMLElement | null) ??
    document.body.appendChild(document.createElement("div"));

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

const HOST_ID = "pretty-md-mermaid-host";

/** Mermaid's parse errors are multi-line with an ASCII pointer; the first line
 *  is the part a reader can act on. */
function firstLine(message: string): string {
  return message.split("\n")[0]?.trim() || "unknown error";
}

/** Resets the memoized Mermaid instance. Tests only. */
export function resetMermaid(): void {
  mermaidPromise = null;
  appliedThemeId = null;
  counter = 0;
}
