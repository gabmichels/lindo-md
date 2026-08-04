/**
 * Renders the math comrak marked up as `<span data-math-style="inline|display">`.
 *
 * KaTeX and its stylesheet are loaded on demand — most documents contain no
 * math, and the CSS alone is ~25 KB.
 */

let katexPromise: Promise<typeof import("katex").default> | null = null;

async function getKatex() {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("katex"),
      // The stylesheet has to be present before the first render or the layout
      // reflows visibly; importing it here keeps it out of the initial bundle.
      import("katex/dist/katex.min.css"),
    ]).then(([module]) => module.default);
  }
  return katexPromise;
}

/**
 * Renders every unrendered math span inside `root`.
 *
 * `throwOnError` is off: a document with one malformed formula should still
 * render, showing the offending source in the error color rather than failing
 * the whole pass.
 */
export async function renderMath(root: HTMLElement): Promise<void> {
  const nodes = root.querySelectorAll<HTMLElement>(
    "[data-math-style]:not([data-math-rendered])",
  );
  if (nodes.length === 0) return;

  const katex = await getKatex();

  for (const node of nodes) {
    const source = node.dataset.source ?? node.textContent ?? "";
    node.dataset.source = source;
    try {
      katex.render(stripDelimiters(source), node, {
        displayMode: node.dataset.mathStyle === "display",
        throwOnError: false,
        output: "html",
      });
    } catch {
      node.textContent = source;
      node.classList.add("math-error");
    }
    node.dataset.mathRendered = "true";
  }
}

/** comrak keeps the `$`/`$$` delimiters in the span's text; KaTeX wants the
 *  formula without them. */
function stripDelimiters(source: string): string {
  const trimmed = source.trim();
  for (const delimiter of ["$$", "$"]) {
    if (
      trimmed.startsWith(delimiter) &&
      trimmed.endsWith(delimiter) &&
      trimmed.length > delimiter.length * 2 - 1
    ) {
      return trimmed.slice(delimiter.length, -delimiter.length).trim();
    }
  }
  return trimmed;
}

/** Exported for tests — the delimiter handling is the only logic here worth
 *  pinning down, and it is easy to get wrong for `$a$$b$`-style input. */
export const _stripDelimiters = stripDelimiters;
