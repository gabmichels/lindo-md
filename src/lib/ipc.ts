import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { z } from "zod";

import { StoredSessionSchema } from "./tabs/schema";
import { ThemeSchema, type Theme } from "./theme/schema";

/**
 * The only place `invoke` is called.
 *
 * Every response is parsed with a zod schema before it reaches a component, so a
 * Rust-side shape change fails here — with the command name attached — instead of
 * surfacing three renders later as `undefined is not an object`.
 *
 * Argument names are `camelCase` on this side and `snake_case` in Rust; Tauri
 * converts between them.
 */

function parseOrThrow<T>(source: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `${source} returned an unexpected shape: ${JSON.stringify(result.error.issues)}`,
    );
  }
  return result.data;
}

async function call<T>(
  command: string,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
): Promise<T> {
  return parseOrThrow(command, schema, await invoke(command, args));
}

// --- documents --------------------------------------------------------------

export const HeadingSchema = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string(),
  id: z.string(),
});
export type Heading = z.infer<typeof HeadingSchema>;

/** One run of caret-addressable text and where it lives in the source. Offsets
 *  are indices into `Document.source` as a JavaScript string — Rust converts
 *  them from bytes, because the two disagree on any non-ASCII character. */
export const TextRunSchema = z.object({
  text: z.string(),
  sourceStart: z.number().int().nonnegative(),
  sourceEnd: z.number().int().nonnegative(),
});
export type TextRun = z.infer<typeof TextRunSchema>;

/** Keyed by the `data-sourcepos` attribute on the element it rendered to. Only
 *  blocks whose text was located in full are sent. */
export const BlockMapSchema = z.object({
  sourcepos: z.string(),
  runs: z.array(TextRunSchema),
  aligned: z.boolean(),
});
export type BlockMap = z.infer<typeof BlockMapSchema>;

export const DocumentSchema = z.object({
  path: z.string(),
  dir: z.string(),
  name: z.string(),
  html: z.string(),
  toc: z.array(HeadingSchema),
  frontmatter: z.string().nullable(),
  title: z.string(),
  /** The Markdown behind `html`. Every edit is a transform of this string; the
   *  rendered DOM is only ever asked where the caret is. */
  source: z.string(),
  /** Handed back on save, so a file that changed on disk is refused rather than
   *  overwritten. */
  contentHash: z.string(),
  /** Where each block's rendered text lives in `source`. Describes exactly this
   *  `source` and this `html`, which is why it travels with them. */
  blocks: z.array(BlockMapSchema),
});
export type Document = z.infer<typeof DocumentSchema>;

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

// A tree is recursive, which zod needs told explicitly via a getter.
export const TreeNodeSchema: z.ZodType<TreeNode> = z.object({
  name: z.string(),
  path: z.string(),
  isDir: z.boolean(),
  get children() {
    return z.array(TreeNodeSchema);
  },
});

export function openDocument(path: string): Promise<Document> {
  return call("open_document", DocumentSchema, { path });
}

/**
 * Writes an edited document and returns it re-rendered.
 *
 * `expectedHash` is the `contentHash` of the document this edit was made
 * against. If the file has changed since, the save is refused rather than
 * silently discarding whatever else wrote to it.
 */
export function saveDocument(
  path: string,
  source: string,
  expectedHash: string,
): Promise<Document> {
  return call("save_document", DocumentSchema, { path, source, expectedHash });
}

export function scanFolder(
  path: string,
  respectGitignore: boolean,
  showHidden: boolean,
): Promise<TreeNode[]> {
  return call("scan_folder", z.array(TreeNodeSchema), {
    path,
    respectGitignore,
    showHidden,
  });
}

/** Replaces the current watch set. Every open document is watched, not just the
 *  visible one, so a background tab still live-reloads. An empty list and no
 *  folder stops watching. */
export function watchPaths(documents: string[], folder: string | null): Promise<void> {
  return call("watch_paths", z.void(), { documents, folder });
}

// --- settings ---------------------------------------------------------------

export const AppearanceModeSchema = z.enum(["light", "dark", "system"]);
export type AppearanceMode = z.infer<typeof AppearanceModeSchema>;

/** Mirrors `AppConfig` in `src-tauri/src/config.rs`. Adding a field means adding
 *  it in both places — except `customThemes` and `session`, which Rust stores
 *  opaquely so their schemas live only here. */
export const AppConfigSchema = z.object({
  version: z.number(),
  themeId: z.string(),
  appearance: AppearanceModeSchema,
  customThemes: z.array(ThemeSchema),
  railWidth: z.number(),
  railCollapsed: z.boolean(),
  recentFiles: z.array(z.string()),
  lastFolder: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  blockRemoteImages: z.boolean(),
  respectGitignore: z.boolean(),
  showHiddenFiles: z.boolean(),
  reopenLastDocument: z.boolean(),
  zoom: z.number(),
  smartPunctuation: z.boolean(),
  session: StoredSessionSchema,
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export function getConfig(): Promise<AppConfig> {
  return call("get_config", AppConfigSchema);
}

export function setConfig(config: AppConfig): Promise<void> {
  return call("set_config", z.void(), { config });
}

export type { Theme };

// --- files the user picks in a dialog ---------------------------------------
// Narrow commands rather than a webview `fs` permission: each takes one path
// that came from an OS dialog and refuses any extension but its own.

/** The documents the OS has handed us and this window has not collected yet — a
 *  double-clicked `.md`, an "Open with → lindo-md", a launch argument. Empty for
 *  a normal launch, and draining: each hand-off is collected once. */
export function getPendingDocuments(): Promise<string[]> {
  return call("get_pending_documents", z.array(z.string()));
}

export function readThemeFile(path: string): Promise<string> {
  return call("read_theme_file", z.string(), { path });
}

export function writeThemeFile(path: string, contents: string): Promise<void> {
  return call("write_theme_file", z.void(), { path, contents });
}

export function writeHtmlFile(path: string, contents: string): Promise<void> {
  return call("write_html_file", z.void(), { path, contents });
}

// --- system integration -----------------------------------------------------

export const DefaultAppStatusSchema = z.object({
  /** False where lindo-md cannot inspect or request the association — anywhere
   *  but Windows today. The settings row hides itself rather than offering a
   *  control that cannot work. */
  supported: z.boolean(),
  isDefault: z.boolean(),
  currentHandler: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});
export type DefaultAppStatus = z.infer<typeof DefaultAppStatusSchema>;

export function getDefaultAppStatus(): Promise<DefaultAppStatus> {
  return call("get_default_app_status", DefaultAppStatusSchema);
}

/** Opens the OS settings page for the association. It cannot be changed from
 *  inside the app — Windows blocks that by design. */
export function requestDefaultApp(): Promise<void> {
  return call("request_default_app", z.void());
}

// --- events -----------------------------------------------------------------

function subscribe<T>(
  event: string,
  schema: z.ZodType<T>,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  return listen(event, (e) => {
    handler(parseOrThrow(event, schema, e.payload));
  });
}

/** The open document changed on disk. Payload is its path. */
export function onDocumentChanged(handler: (path: string) => void): Promise<UnlistenFn> {
  return subscribe("document-changed", z.string(), handler);
}

/** The OS handed us a document while we were already running — a second launch
 *  routed here by the single-instance plugin, or an Apple Event on macOS. Paired
 *  with `getPendingDocuments`, which covers the hand-offs that land before this
 *  listener exists; see `assoc::OpenQueue` in Rust for why it takes both. */
export function onOpenDocumentRequested(handler: (path: string) => void): Promise<UnlistenFn> {
  return subscribe("open-document", z.string(), handler);
}

/** Where a drag of files from outside the app currently stands. `over` and
 *  `drop` carry every path in the drag, filtered by nobody yet. */
export type FileDrag =
  { phase: "over"; paths: string[] } | { phase: "drop"; paths: string[] } | { phase: "leave" };

/**
 * Files dragged onto the window from the OS.
 *
 * Not an HTML5 `ondrop` handler, which would never fire: `dragDropEnabled` is on
 * (Tauri's default) and it makes the native side swallow the drag before the
 * webview ever sees it. This event is the only route, and it is also the only
 * one that yields real filesystem paths rather than sandboxed `File` objects.
 */
export function onFileDrag(handler: (event: FileDrag) => void): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    switch (payload.type) {
      case "enter":
        handler({ phase: "over", paths: payload.paths });
        break;
      case "drop":
        handler({ phase: "drop", paths: payload.paths });
        break;
      case "leave":
        handler({ phase: "leave" });
        break;
      // `over` is a cursor position, fired continuously for the whole hover and
      // carrying no paths. Nothing here needs it.
    }
  });
}

/** Markdown files appeared or disappeared in the open folder. */
export function onTreeChanged(handler: () => void): Promise<UnlistenFn> {
  return subscribe("tree-changed", z.unknown(), () => {
    handler();
  });
}
