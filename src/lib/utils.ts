import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names, letting a later Tailwind utility win over an earlier one
 *  in the same group — so a component's default can be overridden by a prop. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
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
