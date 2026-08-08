import { openUrl } from "@tauri-apps/plugin-opener";

import { isExternal, isMarkdownPath, resolveRelative, splitFragment, wikilinkPath } from "../utils";

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
    // Never `void` this. `openUrl` rejects when the opener scope does not cover the
    // URL, and an unobserved rejection is exactly how v1.0.0 shipped with every
    // external link dead: the click was swallowed, nothing was logged, and the only
    // symptom was that nothing happened.
    // comrak's mark on `[[Note]]`, kept through the sanitizer for exactly this.
    const wikilink = anchor.getAttribute("data-wikilink") === "true";
    follow(href, handlers, wikilink).catch((error: unknown) => {
      console.error(`lindo-md: could not follow link ${href}`, error);
    });
  };
}

/** Where a clicked href goes, decided without doing anything about it. */
export type LinkTarget =
  | { kind: "external"; url: string }
  | { kind: "anchor"; fragment: string }
  | { kind: "document"; path: string; fragment: string }
  | { kind: "handoff"; path: string };

/**
 * Classifies a link. Pure, so the routing rules can be tested without standing up
 * the opener plugin — which is the only reason this is separate from `follow`.
 *
 * The interesting case is the last one. lindo-md can *display* a `.txt`, but a
 * `[notes](notes.txt)` written inside someone's document has always opened whatever
 * they use for text files, and quietly capturing it would be a regression wearing a
 * feature's clothes. So this asks `isMarkdownPath`, which is narrower than
 * `isOpenablePath` on purpose — the file tree, the dialog and the drop target all use
 * the wider one.
 */
export function linkTarget(dir: string, href: string, wikilink = false): LinkTarget {
  if (isExternal(href)) return { kind: "external", url: href };

  const { path, fragment } = splitFragment(href);
  if (!path) return { kind: "anchor", fragment: decodeURIComponent(fragment) };

  // The two differ only in that a wikilink target has no extension to resolve
  // against — see `wikilinkPath`. Everything after this point is the same
  // question for both, which is why they share the rest of the function rather
  // than getting a branch of their own.
  const target = decodeURIComponent(path);
  const resolved = wikilink ? wikilinkPath(dir, target) : resolveRelative(dir, target);
  if (isMarkdownPath(resolved)) {
    return { kind: "document", path: resolved, fragment: decodeURIComponent(fragment) };
  }

  // A local file we do not capture — a PDF, an image, a source file, or a text file
  // the reader has their own editor for. The OS knows what to do with it.
  return { kind: "handoff", path: resolved };
}

async function follow(href: string, handlers: LinkHandlers, wikilink: boolean): Promise<void> {
  const target = linkTarget(handlers.dir, href, wikilink);

  switch (target.kind) {
    case "external":
      await openUrl(target.url);
      return;
    case "anchor":
      handlers.scrollToAnchor(target.fragment);
      return;
    case "document":
      handlers.openDocument(target.path, target.fragment);
      return;
    case "handoff":
      await openUrl(target.path);
  }
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
