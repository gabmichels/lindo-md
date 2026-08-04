import { convertFileSrc } from "@tauri-apps/api/core";

import { isExternal, resolveRelative } from "../utils";

/**
 * Rewrites image sources so a local document's pictures actually appear.
 *
 * Two separate concerns:
 *
 *  - **Local images** are relative to the document, and the webview cannot read
 *    the filesystem. `convertFileSrc` turns the resolved path into an
 *    `asset:` URL, which the Rust side has scoped to the document's own
 *    directory (see `files::read`).
 *  - **Remote images** are blocked by default. Opening someone else's document
 *    should not tell a server that you did; a tracking pixel is an image. The
 *    reader can load them per document with one click.
 */

export interface ImageOptions {
  /** The open document's directory — the base for relative paths. */
  dir: string;
  blockRemote: boolean;
}

export function resolveImages(root: HTMLElement, options: ImageOptions): void {
  for (const img of root.querySelectorAll("img")) {
    const original = img.dataset.originalSrc ?? img.getAttribute("src") ?? "";
    if (!original) continue;
    img.dataset.originalSrc = original;

    if (isExternal(original)) {
      applyRemotePolicy(img, original, options.blockRemote);
      continue;
    }
    if (original.startsWith("data:")) continue;

    img.src = convertFileSrc(resolveRelative(options.dir, original));
    img.loading = "lazy";
    // A local image that is missing is worth showing plainly, rather than as the
    // browser's broken-image glyph, since the path is the useful information.
    img.addEventListener("error", () => markMissing(img, original), {
      once: true,
    });
  }
}

function applyRemotePolicy(
  img: HTMLImageElement,
  original: string,
  block: boolean,
): void {
  if (!block) {
    img.src = original;
    img.loading = "lazy";
    delete img.dataset.blocked;
    return;
  }

  // Clearing `src` rather than hiding the element: the request must not be made
  // at all, which is the entire point.
  img.removeAttribute("src");
  img.dataset.blocked = "true";
  img.title = `Remote image blocked — ${original}`;
}

/** Loads every blocked remote image in the document. Called from the "load
 *  images" affordance, which is per document and not remembered. */
export function loadBlockedImages(root: HTMLElement): void {
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-blocked]")) {
    const original = img.dataset.originalSrc;
    if (!original) continue;
    img.src = original;
    img.loading = "lazy";
    delete img.dataset.blocked;
  }
}

export function hasBlockedImages(root: HTMLElement): boolean {
  return root.querySelector("img[data-blocked]") !== null;
}

function markMissing(img: HTMLImageElement, original: string): void {
  img.dataset.missing = "true";
  img.title = `Image not found — ${original}`;
  if (!img.alt) img.alt = original;
}
