import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names, letting a later Tailwind utility win over an earlier one
 *  in the same group — so a component's default can be overridden by a prop. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Marks an element as a handle the window can be dragged by.
 *
 * Two mechanisms, because they are two platforms' answers to the same question
 * and neither covers both. WebView2 is Chromium and implements the CSS
 * `app-region` property, which is what the `drag-region` utility sets; WKWebView
 * does not implement it at all, so on macOS Tauri looks for its own attribute
 * instead. Setting only the class is exactly the bug that shipped: a titlebar
 * you could drag on Windows and not on macOS.
 *
 * Returned as props rather than left to each call site so the two can never be
 * applied by halves.
 *
 * Note the attribute applies only to the element it sits on and never to its
 * children, so unlike the CSS property it needs no `no-drag` counterpart to keep
 * buttons clickable — `no-drag` is still required for the Chromium side.
 */
export function dragRegion(className?: ClassValue) {
  return { className: cn("drag-region", className), "data-tauri-drag-region": true };
}

/**
 * Resolves a relative href against a document's directory, the way a Markdown
 * link means it. Absolute paths, URLs and bare anchors are returned untouched.
 *
 * Deliberately string-based rather than using the `path` API: this runs in the
 * webview on every link in the document, and the shapes it has to handle —
 * `./a.md`, `../b/c.md`, `img/x.png#frag` — are simple enough to do exactly.
 */
export function resolveRelative(dir: string, href: string): string {
  if (isExternal(href) || href.startsWith("#")) return href;

  const separator = dir.includes("\\") ? "\\" : "/";
  const normalized = href.replace(/\\/g, "/");
  if (isAbsolute(normalized)) return href;

  const segments = dir.split(/[\\/]/).filter((s) => s.length > 0);
  // Preserve a POSIX leading slash, which `filter` above just dropped.
  const rooted = dir.startsWith("/") || dir.startsWith("\\");

  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const joined = segments.join(separator);
  return rooted ? `${separator}${joined}` : joined;
}

export function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(href) || href.startsWith("mailto:");
}

function isAbsolute(href: string): boolean {
  // POSIX root, a Windows drive letter, or a UNC path.
  return href.startsWith("/") || /^[a-z]:\//i.test(href) || href.startsWith("//");
}

/** Splits `page.md#section` into its parts. A fragment-only href has no path. */
export function splitFragment(href: string): { path: string; fragment: string } {
  const index = href.indexOf("#");
  if (index < 0) return { path: href, fragment: "" };
  return { path: href.slice(0, index), fragment: href.slice(index + 1) };
}

const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"];

/** Whether a link points at another document we can open in-app, rather than at
 *  a file the OS should handle. */
export function isMarkdownPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXTENSIONS.includes(extension);
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirname(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join(path.includes("\\") ? "\\" : "/");
}
