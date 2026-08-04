import { openUrl } from "@tauri-apps/plugin-opener";

import { isExternal, isMarkdownPath, resolveRelative, splitFragment } from "../utils";

/**
 * Decides what a click on a link in the document does. Three outcomes, and the
 * distinction matters:
 *
 *  - `#anchor` scrolls, and never navigates
 *  - another `.md` file opens in the app, keeping the reader inside the document
 *    set they are reading
 *  - anything else goes to the OS browser, because a viewer is not a browser and
 *    should not become one
 */

export interface LinkHandlers {
  /** The open document's directory — the base for relative links. */
  dir: string;
  openDocument: (path: string, fragment: string) => void;
  scrollToAnchor: (id: string) => void;
}

/**
 * Returns a click handler for the document root. One delegated listener rather
 * than a listener per link: a large document can hold thousands, and they are
 * replaced on every render.
 */
export function linkClickHandler(handlers: LinkHandlers) {
  return (event: MouseEvent): void => {
    // Let the browser's own affordances win: middle-click, and modifier-clicks
    // that mean "open elsewhere".
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = (event.target as Element | null)?.closest("a");
    const href = anchor?.getAttribute("href");
    if (!anchor || !href) return;

    event.preventDefault();
    void follow(href, handlers);
  };
}

async function follow(href: string, handlers: LinkHandlers): Promise<void> {
  if (isExternal(href)) {
    await openUrl(href);
    return;
  }

  const { path, fragment } = splitFragment(href);

  if (!path) {
    handlers.scrollToAnchor(decodeURIComponent(fragment));
    return;
  }

  const resolved = resolveRelative(handlers.dir, decodeURIComponent(path));

  if (isMarkdownPath(resolved)) {
    handlers.openDocument(resolved, decodeURIComponent(fragment));
    return;
  }

  // A local file we do not render — a PDF, an image, a source file. The OS knows
  // what to do with it better than we do.
  await openUrl(resolved);
}

/**
 * Marks external links so the stylesheet can distinguish them. Kept separate
 * from click handling so it can run once per render rather than per click.
 */
export function markExternalLinks(root: HTMLElement): void {
  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (isExternal(href)) {
      anchor.setAttribute("data-external", "true");
    } else if (href.startsWith("#")) {
      anchor.setAttribute("data-anchor", "true");
    }
  }
}
