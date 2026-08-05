import type { Highlighter } from "shiki";

import { HOUSE_THEMES } from "../theme/shiki-house";

/**
 * Syntax highlighting for `<pre class="code-block">` blocks, which is what
 * `markdown.rs` emits for every non-Mermaid fence.
 *
 * Shiki is loaded dynamically and languages are pulled in one at a time, on
 * demand: the full bundle is tens of megabytes of grammars, and a document
 * typically uses two or three. Never turn these into static imports.
 */

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedThemes = new Set<string>();
const loadedLanguages = new Set<string>();

/** Languages Shiki does not know, remembered so a document full of pseudo-code
 *  fences does not retry a failing import on every render. */
const unknownLanguages = new Set<string>();

async function getHighlighter(theme: string): Promise<Highlighter> {
  if (!highlighterPromise) {
    const { createHighlighter } = await import("shiki");
    highlighterPromise = createHighlighter({ themes: [], langs: [] });
  }
  const highlighter = await highlighterPromise;

  if (!loadedThemes.has(theme)) {
    // House's themes are ours and are not in Shiki's bundle; everything else is
    // fetched from it by id.
    const house = HOUSE_THEMES[theme];
    await highlighter.loadTheme(house ?? (theme as never));
    loadedThemes.add(theme);
  }

  return highlighter;
}

async function ensureLanguage(highlighter: Highlighter, lang: string): Promise<boolean> {
  if (loadedLanguages.has(lang)) return true;
  if (unknownLanguages.has(lang)) return false;

  try {
    await highlighter.loadLanguage(lang as never);
    loadedLanguages.add(lang);
    return true;
  } catch {
    // An unknown language is not an error worth surfacing — the block still
    // renders, just without colors, which is exactly what GitHub does.
    unknownLanguages.add(lang);
    return false;
  }
}

/**
 * Highlights one block in place. The original text is kept in `data-source` so a
 * later theme change can re-highlight without re-reading the document, and so
 * the copy button always copies the code rather than the rendered spans.
 */
export async function highlightBlock(block: HTMLElement, theme: string): Promise<void> {
  const code = block.querySelector("code");
  if (!code) return;

  const source = block.dataset.source ?? code.textContent;
  block.dataset.source = source;

  const lang = block.dataset.lang;
  if (!lang) {
    block.dataset.highlighted = theme;
    return;
  }

  const highlighter = await getHighlighter(theme);
  if (!(await ensureLanguage(highlighter, lang))) {
    block.dataset.highlighted = theme;
    return;
  }

  const html = highlighter.codeToHtml(source, {
    lang,
    theme,
    // The block's own chrome — padding, radius, the filename header — is ours;
    // Shiki only supplies the colored spans inside.
    structure: "inline",
  });

  code.innerHTML = html;
  block.dataset.highlighted = theme;
}

/** True when the block already carries this theme's highlighting, so a re-render
 *  pass can skip it. */
export function isHighlighted(block: HTMLElement, theme: string): boolean {
  return block.dataset.highlighted === theme;
}

/** Drops the cached highlighter. Only used by tests — the app keeps one for its
 *  lifetime, since loading grammars twice is pure cost. */
export function resetHighlighter(): void {
  highlighterPromise = null;
  loadedThemes.clear();
  loadedLanguages.clear();
  unknownLanguages.clear();
}
