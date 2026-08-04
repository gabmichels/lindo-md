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
      fontFamily: theme.typography.bodyFont,
    });
    appliedThemeId = theme.id;
  }

  return mermaid;
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
    const { svg } = await mermaid.render(`mermaid-${counter++}`, source);

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
