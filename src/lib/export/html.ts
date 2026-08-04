import { docTokens } from "../theme/apply";
import type { Theme } from "../theme/schema";

/**
 * Builds a standalone HTML file from the document as it is currently rendered.
 *
 * "Standalone" is the requirement that shapes everything here: the file has to
 * look identical when opened on a machine that has never seen lindo-md, with no
 * network. So the theme's tokens are inlined, the stylesheet is inlined, and the
 * DOM is taken *after* enhancement — highlighted code and rendered Mermaid SVGs
 * come along as markup rather than as something to re-run.
 *
 * Fonts are referenced by family name with a stack, not embedded: embedding the
 * bundled faces would add several megabytes to every export, and a document that
 * falls back to Georgia still reads correctly.
 */

export interface ExportOptions {
  title: string;
  theme: Theme;
  /** The rendered `.doc` element, after the enhancement passes have run. */
  article: HTMLElement;
  /** The document's own stylesheet, inlined verbatim. */
  documentCss: string;
}

export function buildStandaloneHtml(options: ExportOptions): string {
  const { title, theme, article, documentCss } = options;

  const tokens = Object.entries(docTokens(theme))
    .map(([property, value]) => `      ${property}: ${value};`)
    .join("\n");

  return `<!doctype html>
<html lang="en" data-appearance="${theme.appearance}" data-line-numbers="${theme.code.lineNumbers}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="generator" content="lindo-md" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
${tokens}
        color-scheme: ${theme.appearance};
      }

      body {
        margin: 0;
        background: var(--doc-bg);
      }

${documentCss}
    </style>
  </head>
  <body>
    <div class="doc-scroller">
      <article class="doc">
${cleanedMarkup(article)}
      </article>
    </div>
  </body>
</html>
`;
}

/**
 * Strips the parts of the live DOM that only make sense inside the app: the copy
 * buttons, and the `data-*` bookkeeping the enhancement passes used. Blocked
 * remote images are restored to their original source, since the export is a
 * file the user is choosing to keep.
 */
function cleanedMarkup(article: HTMLElement): string {
  const clone = article.cloneNode(true) as HTMLElement;

  for (const button of clone.querySelectorAll(".code-copy")) {
    button.remove();
  }

  for (const img of clone.querySelectorAll<HTMLImageElement>("img")) {
    const original = img.dataset.originalSrc;
    if (original && img.dataset.blocked) img.setAttribute("src", original);
    delete img.dataset.blocked;
    delete img.dataset.originalSrc;
    delete img.dataset.missing;
  }

  for (const element of clone.querySelectorAll<HTMLElement>("[data-source]")) {
    delete element.dataset.source;
    delete element.dataset.highlighted;
    delete element.dataset.rendered;
  }

  return clone.innerHTML;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const _escapeHtml = escapeHtml;
export const _cleanedMarkup = cleanedMarkup;
