import { DEFAULT_VIEW, docTokens, viewTokens, type DocView } from "../theme/apply";
import { isSafeCssValue, type Theme } from "../theme/schema";
import { isOpenablePath, splitFragment } from "../utils";

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
  /** The document's YAML frontmatter, or null. Carried into the file for the
   *  same reason it is shown on screen: it is content the document has, and an
   *  export that quietly drops it is the bug this was written to fix, moved to
   *  another surface. */
  frontmatter?: string | null;
  /** The reader's view. Only the width half of it is carried into the file: an
   *  export should be as wide as the page you were looking at, but zoom belongs
   *  to this window and has no meaning in someone else's browser. */
  view?: Partial<DocView>;
}

export function buildStandaloneHtml(options: ExportOptions): string {
  const { title, theme, article, documentCss } = options;
  const view = { ...DEFAULT_VIEW, ...options.view, zoom: 1 };

  // `ThemeSchema` already refuses these characters, so nothing that has been through
  // `parseThemeFile` can trip this. It is here because this is the one place a theme
  // becomes *text* rather than going through `setProperty`, and a `</style>` in a
  // token value would end the element and start running markup. A token that cannot
  // be written safely is dropped rather than escaped: the value has no legitimate
  // meaning, and a half-escaped colour is not worth reconstructing.
  const tokens = Object.entries({ ...docTokens(theme), ...viewTokens(view) })
    .filter(([, value]) => isSafeCssValue(value))
    .map(([property, value]) => `      ${property}: ${value};`)
    .join("\n");

  return `<!doctype html>
<html lang="en" data-appearance="${theme.appearance}" data-line-numbers="${theme.code.lineNumbers}" data-heading-numbers="${theme.layout.numberHeadings}">
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
${frontmatterMarkup(options.frontmatter)}      <article class="doc">
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

  // Where each element came from in the .md file. Meaningful only to the editor,
  // and on nearly every element — leaving it in would bloat the export and leak
  // the shape of a file the reader is not shipping.
  for (const element of clone.querySelectorAll<HTMLElement>("[data-sourcepos]")) {
    element.removeAttribute("data-sourcepos");
  }

  // A wikilink is app-only bookkeeping in the same way, but removing the
  // attribute alone would leave `href="Design%20Notes"` — a link to a name with
  // no extension, which resolves to nothing anywhere outside this app. The
  // extension only exists in `wikilinkPath`, so spell it out here and the export
  // carries the same relative link an ordinary `[label](Design Notes.md)` would.
  for (const anchor of clone.querySelectorAll<HTMLAnchorElement>("a[data-wikilink]")) {
    anchor.removeAttribute("data-wikilink");
    const href = anchor.getAttribute("href");
    if (href) anchor.setAttribute("href", exportedWikilinkHref(href));
  }

  return clone.innerHTML;
}

/**
 * The frontmatter block, or nothing at all.
 *
 * The only place in this file where **document text** becomes markup rather than
 * being cloned from a DOM that has already been through ammonia. `cleanedMarkup`
 * works on nodes; this is a raw string off `Document.frontmatter`, which is
 * whatever the file's author typed — so it is escaped here, and a
 * `</pre><script>` in someone's YAML is text like everything else.
 *
 * Exported open, unlike on screen. A `<details>` in a file someone opens once in
 * a browser has no memory of being clicked, and a collapsed block in a document
 * nobody can navigate is just a hidden one.
 */
function frontmatterMarkup(frontmatter: string | null | undefined): string {
  if (!frontmatter) return "";
  return `      <details class="doc-frontmatter" open>
        <summary>Frontmatter</summary>
        <pre>${escapeHtml(frontmatter)}</pre>
      </details>
`;
}

/**
 * The href a wikilink would have had if it were written as an ordinary link.
 *
 * Same rule as `wikilinkPath` — add `.md` unless the target already names
 * something openable — but applied to the href rather than to a resolved path,
 * and without resolving anything: an export is a single file, so the link stays
 * exactly as relative as the document wrote it. The href is left percent-encoded
 * throughout, which is what it has to be in the output anyway, and which is why
 * this does not call `decodeURIComponent` — that throws on a lone `%`, and an
 * export must not fail over one link.
 */
function exportedWikilinkHref(href: string): string {
  const { path, fragment } = splitFragment(href);
  if (!path) return href;
  const target = isOpenablePath(path) ? path : `${path}.md`;
  return fragment ? `${target}#${fragment}` : target;
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
