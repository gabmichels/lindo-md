import type { Theme } from "../theme/schema";
import { renderMath } from "./katex";
import { renderDiagram } from "./mermaid";
import { markExternalLinks } from "./links";
import { resolveImages } from "./images";
import { highlightBlock, isHighlighted } from "./shiki";
import { enableDiagramZoom } from "./zoom";

/**
 * Turns the sanitized HTML from Rust into the finished page.
 *
 * The expensive passes — syntax highlighting and Mermaid — run lazily, driven by
 * an `IntersectionObserver`, because a long document can hold hundreds of code
 * blocks and a reader sees five. The cheap passes (links, images, copy buttons)
 * run immediately, since they affect what the first screen looks like.
 *
 * Everything is idempotent and keyed by theme id, so a theme change re-runs only
 * what actually depends on the theme.
 */

export interface EnhanceOptions {
  theme: Theme;
  /** The document's directory, for resolving relative images. */
  dir: string;
  blockRemoteImages: boolean;
}

/** How far outside the viewport to start work, so a block is ready by the time
 *  it is scrolled to rather than popping in under the reader's eye. */
const PREFETCH_MARGIN = "600px";

export function enhance(root: HTMLElement, options: EnhanceOptions): () => void {
  markExternalLinks(root);
  resolveImages(root, {
    dir: options.dir,
    blockRemote: options.blockRemoteImages,
  });
  addCopyButtons(root);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        observer.unobserve(element);
        void enhanceElement(element, options);
      }
    },
    { rootMargin: PREFETCH_MARGIN },
  );

  for (const element of pendingElements(root, options.theme)) {
    observer.observe(element);
  }

  // Math is neither expensive nor common enough to be worth observing, and a
  // half-rendered formula is more jarring than a late code block.
  void renderMath(root);

  const stopZoom = enableDiagramZoom(root);

  return () => {
    observer.disconnect();
    stopZoom();
  };
}

function pendingElements(root: HTMLElement, theme: Theme): HTMLElement[] {
  const blocks = [...root.querySelectorAll<HTMLElement>("pre.code-block")].filter(
    (block) => !isHighlighted(block, theme.code.shikiTheme),
  );

  const diagrams = [
    ...root.querySelectorAll<HTMLElement>("pre.mermaid-src"),
    ...root.querySelectorAll<HTMLElement>("figure.mermaid"),
  ].filter((figure) => figure.dataset.rendered !== theme.id);

  return [...blocks, ...diagrams];
}

async function enhanceElement(element: HTMLElement, options: EnhanceOptions): Promise<void> {
  if (element.matches("pre.code-block")) {
    await highlightBlock(element, options.theme.code.shikiTheme);
    return;
  }
  await renderDiagram(asDiagramSource(element), options.theme);
}

/**
 * A theme change has to re-render diagrams from scratch, because Mermaid writes
 * colors into the SVG. Turning the rendered figure back into a source block is
 * how the same code path handles both the first render and a re-render.
 */
function asDiagramSource(element: HTMLElement): HTMLElement {
  if (element.matches("pre.mermaid-src")) return element;

  const pre = document.createElement("pre");
  pre.className = "mermaid-src";
  pre.dataset.source = element.dataset.source ?? "";
  pre.textContent = element.dataset.source ?? "";
  element.replaceWith(pre);
  return pre;
}

/**
 * Re-runs only the theme-dependent passes. Called when the reader switches
 * theme, which must not re-fetch or re-parse the document.
 */
export function reenhanceForTheme(root: HTMLElement, options: EnhanceOptions): () => void {
  for (const figure of root.querySelectorAll<HTMLElement>("figure.mermaid")) {
    delete figure.dataset.rendered;
  }
  return enhance(root, options);
}

/**
 * Adds a copy button to every code block. The button copies `data-source`, the
 * text as it was before highlighting — copying the rendered DOM would bring the
 * span structure along and, with line numbers on, the numbers too.
 */
function addCopyButtons(root: HTMLElement): void {
  for (const block of root.querySelectorAll<HTMLElement>("pre.code-block")) {
    if (block.querySelector(".code-copy")) continue;

    const source = block.dataset.source ?? block.textContent;
    block.dataset.source = source;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code to clipboard");

    button.addEventListener("click", () => {
      void navigator.clipboard.writeText(block.dataset.source ?? "").then(
        () => {
          flash(button, "Copied");
        },
        () => {
          flash(button, "Failed");
        },
      );
    });

    block.append(button);
  }
}

function flash(button: HTMLButtonElement, label: string): void {
  const previous = button.textContent;
  button.textContent = label;
  window.setTimeout(() => {
    button.textContent = previous;
  }, 1200);
}
