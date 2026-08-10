import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { z } from "zod";

import { StoredSessionSchema } from "./tabs/schema";
import { ContentWidthSchema, ThemeSchema, type Theme } from "./theme/schema";

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

/**
 * What a command that returns nothing hands back.
 *
 * **`z.void()` is the wrong schema here, and every use of it was a rejection.**
 * Tauri serializes Rust's `()` to JSON `null`, and `z.void()` accepts only
 * `undefined` — so all seven commands returning `LindoResult<()>` did their work
 * in Rust and then threw on the way back, for the whole life of each one.
 *
 * It stayed invisible because of what the callers do with the rejection rather
 * than because it was rare: `setConfig`, `watchPaths` and `reanchorAnnotations`
 * are `.catch(() => undefined)`, so the settings were written, the watch was
 * registered and the re-anchoring was persisted while every one of them reported
 * failure to nobody. The two exports lost only their confirmation — the file was
 * on disk and "Exported to …" never appeared — and "Make lindo-md the default"
 * opened the OS page *and* showed an error. `deleteAnnotation` is the one that
 * finally said it out loud, because annotations are the first feature to put an
 * IPC failure in front of the reader: the mark came back and the notice read
 * `delete_annotation returned an unexpected shape`.
 *
 * `null` and `undefined` are both accepted, so this keeps working if Tauri ever
 * changes its mind; anything else is refused, because a command that starts
 * returning data is exactly the drift this file parses for.
 */
export const NothingSchema = z
  .union([z.null(), z.undefined()])
  .transform((): undefined => undefined);

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
   *  `source` and this `html`, which is why it travels with them. Empty for any
   *  document that is not editable — there is nothing for a caret to address. */
  blocks: z.array(BlockMapSchema),
  /**
   * Whether an edit made here can be written back.
   *
   * Required rather than defaulted: a `Document` is never persisted, so there is no
   * older file to stay compatible with, and a missing field would mean Rust and this
   * schema disagree. Failing loudly at the IPC boundary with the command name
   * attached beats silently deciding a `.log` is editable.
   *
   * This drives affordances only. `files::save` refuses independently — see the
   * field's doc comment in `src-tauri/src/files.rs`.
   */
  editable: z.boolean(),
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

/**
 * Who chose this path. `"document"` means a link inside a file did, and Rust
 * restricts what such a path may be — see `files::Origin`. It is a required
 * argument rather than an optional one so that a new call site has to answer the
 * question; Rust treats an absent value as `"document"` regardless, so the
 * failure mode of forgetting is a refusal rather than a hole.
 */
export type DocumentOrigin = "reader" | "document";

export function openDocument(path: string, origin: DocumentOrigin): Promise<Document> {
  return call("open_document", DocumentSchema, { path, origin });
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
  return call("watch_paths", NothingSchema, { documents, folder });
}

// --- settings ---------------------------------------------------------------

export const AppearanceModeSchema = z.enum(["light", "dark", "system"]);
export type AppearanceMode = z.infer<typeof AppearanceModeSchema>;

/**
 * Every custom theme that still parses, in order.
 *
 * The same treatment `StoredSessionSchema` already documents next door, and for the
 * same reason — it just only ran one way. A `z.array(ThemeSchema)` rejects the whole
 * array if any single element fails, `parseOrThrow` then rejects the whole config,
 * and `useConfig` falls back to defaults. One theme missing one field therefore took
 * out every other theme, the recents, the last folder and the saved session with it.
 *
 * That is not hypothetical maintenance-wise: tightening `ThemeSchema` in a release
 * invalidates every stored theme at once, which is a normal thing to want to do.
 *
 * Dropping the unreadable one loses less than refusing the file does, and it is what
 * `config.rs` already promises: "A corrupt config is reported, never silently reset —
 * the user's carefully tuned custom themes live in this file."
 */
export const StoredCustomThemesSchema = z.unknown().transform((value): Theme[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = ThemeSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
});

/** Mirrors `AppConfig` in `src-tauri/src/config.rs`. Adding a field means adding
 *  it in both places — except `customThemes` and `session`, which Rust stores
 *  opaquely so their schemas live only here. */
export const AppConfigSchema = z.object({
  version: z.number(),
  themeId: z.string(),
  appearance: AppearanceModeSchema,
  customThemes: StoredCustomThemesSchema,
  railWidth: z.number(),
  railCollapsed: z.boolean(),
  railTreeCollapsed: z.boolean(),
  notesOpen: z.boolean(),
  notesWidth: z.number(),
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
  /** Defaulted so a config written before these settings existed still loads —
   *  Rust supplies them too, but an older `config.json` reaches zod first. */
  contentWidth: ContentWidthSchema.default("standard"),
  checkForUpdates: z.boolean().default(true),
  session: StoredSessionSchema,
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export function getConfig(): Promise<AppConfig> {
  return call("get_config", AppConfigSchema);
}

export function setConfig(config: AppConfig): Promise<void> {
  return call("set_config", NothingSchema, { config });
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
  return call("write_theme_file", NothingSchema, { path, contents });
}

export function writeHtmlFile(path: string, contents: string): Promise<void> {
  return call("write_html_file", NothingSchema, { path, contents });
}

/** Writes the document with its annotations written in, to a path the reader
 *  chose. Rust refuses anything that is not a Markdown extension, so an export
 *  always lands as a file this app can open — and still annotate — again. */
export function writeMarkdownFile(path: string, contents: string): Promise<void> {
  return call("write_markdown_file", NothingSchema, { path, contents });
}

// --- annotations -------------------------------------------------------------
// Storage only. Whether an annotation still points at the words it was put on is
// decided in `lib/annotate/anchor.ts`, against the document's own source — Rust
// never resolves an anchor. See the module docs in `src-tauri/src/annotations.rs`.

export const AnnotationSchema = z.object({
  id: z.number().int(),
  path: z.string(),
  /** Which of the theme's highlight slots paints this mark — not a colour value.
   *  A theme rewrites every `--doc-*` token, so a stored `#ffee00` would freeze a
   *  mark to a colour that clashes with the next theme the reader picks. */
  color: z.string(),
  /** The margin note. Empty for a bare highlight; there is no separate kind. */
  body: z.string(),
  quote: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  /** Indices into `Document.source` as a JavaScript string — UTF-16 code units
   *  into the LF-normalized text, the same numbers `BlockMap` runs use. Not
   *  bytes, and not offsets into the file as it sits on disk. */
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  /** The `contentHash` those offsets were computed against. */
  anchoredHash: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

/**
 * Drops an annotation this build cannot read rather than rejecting the whole
 * list, for the reason `StoredCustomThemesSchema` gives next door: these rows are
 * the reader's own notes, they outlive any single release, and tightening this
 * schema — adding a colour-slot enum, say — is a normal thing to want to do. One
 * unreadable row must not take out the rest of a document's marks.
 */
export const AnnotationListSchema = z.unknown().transform((value): Annotation[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = AnnotationSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
});

/** What an annotation needs before the store gives it an id and timestamps. */
export interface NewAnnotation {
  path: string;
  color: string;
  body: string;
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  anchoredHash: string;
}

/** One annotation's offsets, re-found after the document changed under it. */
export interface Reanchor {
  id: number;
  startOffset: number;
  endOffset: number;
  anchoredHash: string;
}

export function listAnnotations(path: string): Promise<Annotation[]> {
  return call("list_annotations", AnnotationListSchema, { path });
}

/** Looks for this document's marks under a path it used to have, after a rename
 *  or a move. Returns how many were found, so a caller knows whether to list
 *  again. Only ever called when a load came back empty — see
 *  `annotations::relink` for the conditions that keep it from claiming a copy's
 *  marks. */
export function relinkAnnotations(path: string, contentHash: string): Promise<number> {
  return call("relink_annotations", z.number().int().nonnegative(), { path, contentHash });
}

export function createAnnotation(annotation: NewAnnotation): Promise<Annotation> {
  return call("create_annotation", AnnotationSchema, { annotation });
}

/** Persists offsets re-found after an edit, so the search runs once rather than
 *  on every load. Applied in one transaction: half a document's marks agreeing
 *  with the new file and half still claiming the old hash is worse than none. */
export function reanchorAnnotations(updates: Reanchor[]): Promise<void> {
  return call("reanchor_annotations", NothingSchema, { updates });
}

export function deleteAnnotation(id: number): Promise<void> {
  return call("delete_annotation", NothingSchema, { id });
}

/** Changes the colour slot, the note, or both, and hands back the row as it now
 *  stands — including the `updatedAt` that decides where its document sits in
 *  the panel. Where a mark *points* changes only through `reanchorAnnotations`. */
export function updateAnnotation(id: number, color: string, body: string): Promise<Annotation> {
  return call("update_annotation", AnnotationSchema, { id, color, body });
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
  return call("request_default_app", NothingSchema);
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

/** Openable files appeared or disappeared in the open folder. */
export function onTreeChanged(handler: () => void): Promise<UnlistenFn> {
  return subscribe("tree-changed", z.unknown(), () => {
    handler();
  });
}
