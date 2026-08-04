import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { z } from "zod";

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

export const DocumentSchema = z.object({
  path: z.string(),
  dir: z.string(),
  name: z.string(),
  html: z.string(),
  toc: z.array(HeadingSchema),
  frontmatter: z.string().nullable(),
  title: z.string(),
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

/** Replaces the current watch set. Passing nothing stops watching. */
export function watchPaths(
  document: string | null,
  folder: string | null,
): Promise<void> {
  return call("watch_paths", z.void(), { document, folder });
}

// --- settings ---------------------------------------------------------------

export const AppearanceModeSchema = z.enum(["light", "dark", "system"]);
export type AppearanceMode = z.infer<typeof AppearanceModeSchema>;

/** Mirrors `AppConfig` in `src-tauri/src/config.rs`. Adding a field means adding
 *  it in both places — except `customThemes`, which Rust stores opaquely so the
 *  `Theme` schema lives only here. */
export const AppConfigSchema = z.object({
  version: z.number(),
  themeId: z.string(),
  appearance: AppearanceModeSchema,
  customThemes: z.array(ThemeSchema),
  railWidth: z.number(),
  railCollapsed: z.boolean(),
  recentFiles: z.array(z.string()),
  lastFolder: z.string().nullish().transform((v) => v ?? null),
  blockRemoteImages: z.boolean(),
  respectGitignore: z.boolean(),
  showHiddenFiles: z.boolean(),
  reopenLastDocument: z.boolean(),
  zoom: z.number(),
  smartPunctuation: z.boolean(),
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

/** The document the app was launched with — a double-clicked `.md`, or
 *  "Open with → lindo-md". `null` for a normal launch. */
export function getInitialDocument(): Promise<string | null> {
  return call("get_initial_document", z.string().nullable());
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
  currentHandler: z.string().nullish().transform((v) => v ?? null),
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
  return listen(event, (e) => handler(parseOrThrow(event, schema, e.payload)));
}

/** The open document changed on disk. Payload is its path. */
export function onDocumentChanged(
  handler: (path: string) => void,
): Promise<UnlistenFn> {
  return subscribe("document-changed", z.string(), handler);
}

/** A second launch handed us a document — the single-instance plugin routes it
 *  here rather than opening another window. */
export function onOpenDocumentRequested(
  handler: (path: string) => void,
): Promise<UnlistenFn> {
  return subscribe("open-document", z.string(), handler);
}

/** Markdown files appeared or disappeared in the open folder. */
export function onTreeChanged(handler: () => void): Promise<UnlistenFn> {
  return subscribe("tree-changed", z.unknown(), () => handler());
}
