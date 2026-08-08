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

/* The three extension classes, mirroring `src-tauri/src/files.rs`. Rust decides what
 * a file *is* — these exist because the dialog, the drop target and the link router
 * all have to answer before any IPC round trip. `utils.test.ts` reads the Rust arrays
 * off disk and fails if these drift, the same trick `version.test.ts` uses to keep
 * `package.json` and `Cargo.toml` in step. */
const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mkdn", "qmd", "rmd"];
const MDX_EXTENSIONS = ["mdx"];
const PLAIN_TEXT_EXTENSIONS = ["txt", "text", "log", "rst", "adoc"];

function extensionOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Whether a link inside a document should be captured into a tab, rather than handed
 * to whatever the reader has set as their own editor.
 *
 * Deliberately narrower than `isOpenablePath`, and the gap is the point: lindo-md can
 * *display* a `.txt`, but a `[notes](notes.txt)` written inside someone's Markdown has
 * always opened their editor, and quietly taking that over would be a regression
 * dressed as a feature. "We can show this" and "we should intercept this" are
 * different questions.
 */
export function isMarkdownPath(path: string): boolean {
  const extension = extensionOf(path);
  return MARKDOWN_EXTENSIONS.includes(extension) || MDX_EXTENSIONS.includes(extension);
}

/** Every file lindo-md will open: what the tree lists, the dialog offers, and the
 *  drop target accepts. Wider than `isMarkdownPath` — see above. */
export function isOpenablePath(path: string): boolean {
  const extension = extensionOf(path);
  return (
    MARKDOWN_EXTENSIONS.includes(extension) ||
    MDX_EXTENSIONS.includes(extension) ||
    PLAIN_TEXT_EXTENSIONS.includes(extension)
  );
}

/** The open dialog shows two filters rather than one; these back them. */
export const DOCUMENT_EXTENSIONS = [...MARKDOWN_EXTENSIONS, ...MDX_EXTENSIONS];
export const TEXT_EXTENSIONS = [...PLAIN_TEXT_EXTENSIONS];

/**
 * Why a document cannot be edited, or null when it can be.
 *
 * Takes `editable` from the document rather than working it out from the path, so the
 * badge can never contradict what Rust decided — but picks the *wording* from the
 * extension, because "read-only" without a reason reads as a setting someone forgot to
 * turn off. Both of these are properties of the file, and neither has a switch.
 */
export function readOnlyReason(doc: { editable: boolean; path: string }): string | null {
  if (doc.editable) return null;
  if (MDX_EXTENSIONS.includes(extensionOf(doc.path))) {
    return "MDX components are shown as code. Editing would move the JSX out from under the positions an edit is applied with, so this file is read-only.";
  }
  return "Plain text is shown exactly as written, with no Markdown applied — so there is nothing here to edit as Markdown.";
}

/**
 * Where `[[Design Notes]]` points.
 *
 * A wikilink names a note, not a file: the extension is left off, and the reader of
 * an Obsidian or Foam vault has never typed one. So the extension is added back —
 * `.md`, because that is the dialect anything emitting wikilinks writes.
 *
 * It is added by *default* rather than only when the target looks extensionless, and
 * that is the whole subtlety here. `[[Notes v1.2]]` has an "extension" of `2` to any
 * rule that just splits on the last dot, so a rule phrased that way leaves it
 * pointing at a file that does not exist. Asking instead whether the target is
 * already something lindo-md opens gets both that case and `[[README.md]]` right.
 */
export function wikilinkPath(dir: string, target: string): string {
  const resolved = resolveRelative(dir, target);
  return isOpenablePath(resolved) ? resolved : `${resolved}.md`;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirname(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join(path.includes("\\") ? "\\" : "/");
}
