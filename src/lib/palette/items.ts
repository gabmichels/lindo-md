import type { Heading, TreeNode } from "@/lib/ipc";
import { fuzzyMatch } from "@/lib/palette/match";
import { basename, dirname } from "@/lib/utils";

/**
 * What the command palette can show, and how a query narrows it.
 *
 * Everything here is pure: an item is a label and a closure, and the builders
 * turn app state into items without touching the DOM. The component is then
 * only a list — which is what makes the ranking testable, and the ranking is
 * the part that decides whether this feels like Goto Anything or like a filter
 * box.
 */

/**
 * The sources, most-wanted first.
 *
 * The list is never drawn as sections: results are one flat run in score order,
 * because a quick-open that files a perfect name match under a heading called
 * "Files" has buried the answer. The order here is only the tie-break, which is
 * what decides the list when nothing is typed yet.
 */
export const GROUPS = ["Open tabs", "Recent", "Files", "Headings", "Commands", "Theme"] as const;
export type PaletteGroup = (typeof GROUPS)[number];

export interface PaletteItem {
  /** Stable across a query, so the list can be keyed and the selection kept. */
  id: string;
  /** The row's primary text, and the first thing a query is matched against. */
  label: string;
  /** Dimmed, after the label. Matched too, at a discount — a file is often
   *  remembered by its folder rather than by its name. */
  detail?: string;
  group: PaletteGroup;
  /** The keyboard chord that does the same thing, drawn at the row's edge. It
   *  is the only place most readers will ever learn one. */
  chord?: string;
  /** Matched but never shown — synonyms for what a command is called. */
  keywords?: string;
  run: () => void;
}

export interface PaletteResult {
  item: PaletteItem;
  score: number;
  labelRanges: [number, number][];
  detailRanges: [number, number][];
}

/** Which sources a query is asking for. The prefixes are Sublime's, because
 *  that is the vocabulary people arrive with. */
export type PaletteMode = "open" | "commands" | "headings";

export function parseQuery(raw: string): { mode: PaletteMode; query: string } {
  if (raw.startsWith(">")) return { mode: "commands", query: raw.slice(1).trimStart() };
  if (raw.startsWith("@")) return { mode: "headings", query: raw.slice(1).trimStart() };
  return { mode: "open", query: raw.trim() };
}

/** A `detail` match is worth having but should never outrank a name match. */
const DETAIL_PENALTY = 8;

/**
 * Ranks `items` against `query`, dropping the ones that do not match.
 *
 * With an empty query every item survives with an equal score, so the sort is
 * left to the group order and the order the builders produced — most recent
 * first, in practice, which is the right default for a palette opened by
 * reflex.
 */
export function rank(items: PaletteItem[], query: string, limit: number): PaletteResult[] {
  const results: PaletteResult[] = [];

  for (const item of items) {
    const label = fuzzyMatch(query, item.label);
    const detail = item.detail === undefined ? null : fuzzyMatch(query, item.detail);
    const keywords = item.keywords === undefined ? null : fuzzyMatch(query, item.keywords);

    const best = Math.max(
      label?.score ?? -Infinity,
      detail === null ? -Infinity : detail.score - DETAIL_PENALTY,
      keywords === null ? -Infinity : keywords.score - DETAIL_PENALTY,
    );
    if (best === -Infinity) continue;

    results.push({
      item,
      score: best,
      labelRanges: label?.ranges ?? [],
      detailRanges: detail?.ranges ?? [],
    });
  }

  results.sort(
    (a, b) => b.score - a.score || GROUPS.indexOf(a.item.group) - GROUPS.indexOf(b.item.group),
  );
  return results.slice(0, limit);
}

// --- builders ---------------------------------------------------------------

export function tabItems(
  tabs: readonly { id: string; path: string }[],
  activeTabId: string | null,
  activate: (id: string) => void,
): PaletteItem[] {
  return tabs
    .filter((tab) => tab.id !== activeTabId)
    .map((tab) => ({
      id: `tab:${tab.id}`,
      label: basename(tab.path),
      detail: dirname(tab.path),
      group: "Open tabs" as const,
      run: () => {
        activate(tab.id);
      },
    }));
}

/**
 * Recent files, minus the ones already open.
 *
 * The de-duplication is the whole reason this takes `openPaths`: a file that is
 * one tab away should be offered as that tab, not as a second way to arrive at
 * the same document — `tabs/model.ts` would only activate the existing tab
 * anyway, so the duplicate row is a row that does nothing new.
 */
export function recentItems(
  recentFiles: readonly string[],
  openPaths: ReadonlySet<string>,
  open: (path: string) => void,
): PaletteItem[] {
  return recentFiles
    .filter((path) => !openPaths.has(path))
    .map((path) => ({
      id: `recent:${path}`,
      label: basename(path),
      detail: dirname(path),
      group: "Recent" as const,
      run: () => {
        open(path);
      },
    }));
}

/**
 * `path` with the open folder taken off the front, if it is genuinely under it.
 *
 * The prefix has to end at a separator. `startsWith` alone lets the folder `/w`
 * claim `/works/notes.md` and report its folder as `rks`, and a drive root —
 * where `folder` is `C:\` and already ends in one — loses the first character
 * of every filename to the same off-by-one.
 */
function relativeTo(path: string, folder: string | null): string {
  if (folder === null || !path.startsWith(folder)) return path;

  const rest = path.slice(folder.length);
  if (rest.startsWith("/") || rest.startsWith("\\")) return rest.slice(1);
  return /[/\\]$/.test(folder) ? rest : path;
}

/** Every document in the open folder, shown by its path relative to it. */
export function fileItems(
  tree: TreeNode[],
  folder: string | null,
  seen: ReadonlySet<string>,
  open: (path: string) => void,
): PaletteItem[] {
  const items: PaletteItem[] = [];

  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.isDir) {
        walk(node.children);
        continue;
      }
      if (seen.has(node.path)) continue;
      // `dirname` answers with an empty string for a bare filename, and an
      // empty detail would draw a separator with nothing after it.
      const parent = dirname(relativeTo(node.path, folder));
      items.push({
        id: `file:${node.path}`,
        label: node.name,
        detail: parent === "" ? undefined : parent,
        group: "Files",
        run: () => {
          open(node.path);
        },
      });
    }
  };

  walk(tree);
  return items;
}

/**
 * The headings of the open document.
 *
 * Indented by level so the list reads as the outline it is — the palette is the
 * keyboard route to what the rail already shows.
 */
export function headingItems(toc: readonly Heading[], jumpTo: (id: string) => void): PaletteItem[] {
  const base = toc.length === 0 ? 1 : Math.min(...toc.map((heading) => heading.level));
  return toc.map((heading, index) => ({
    // The id repeats when a document has two headings with the same text, and
    // comrak gives them the same anchor; the index keeps the rows distinct.
    id: `heading:${index}:${heading.id}`,
    label: `${"  ".repeat(Math.max(0, heading.level - base))}${heading.text}`,
    group: "Headings" as const,
    run: () => {
      jumpTo(heading.id);
    },
  }));
}

/** Only what a row is made of. A preset and a theme the reader forked are the
 *  same choice here, and neither module has to widen its exports to say so. */
export interface ThemeChoice {
  id: string;
  name: string;
  /** The one-line description a preset carries; a forked theme has none. */
  note?: string;
}

export function themeItems(
  presets: readonly ThemeChoice[],
  customThemes: readonly ThemeChoice[],
  pick: (id: string) => void,
): PaletteItem[] {
  const items: PaletteItem[] = presets.map((preset) => ({
    id: `theme:${preset.id}`,
    label: `Theme: ${preset.name}`,
    detail: preset.note,
    group: "Theme" as const,
    keywords: "appearance colours palette",
    run: () => {
      pick(preset.id);
    },
  }));

  for (const custom of customThemes) {
    items.push({
      // Its own namespace, because `config.json` is a file the reader edits and
      // a custom theme called `house` would otherwise collide with the preset —
      // two rows with one id is a duplicate React key and an `aria-activedescendant`
      // pointing at whichever the DOM found first.
      id: `theme:custom:${custom.id}`,
      label: `Theme: ${custom.name}`,
      detail: "Your theme",
      group: "Theme",
      keywords: "appearance colours palette custom",
      run: () => {
        pick(custom.id);
      },
    });
  }

  return items;
}

/**
 * Everything the app can be told to do.
 *
 * This is deliberately the same object the keyboard shortcuts are wired from
 * (`App.tsx`), so a command and its chord cannot drift apart: adding an action
 * in one place makes it reachable from both, and a chord shown on a row is the
 * chord that is actually bound.
 */
export interface PaletteActions {
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onNewTab: () => void;
  onCloseTab: () => void;
  onReopenTab: () => void;
  onCycleTab: (delta: number) => void;
  onBack: () => void;
  onForward: () => void;
  onFind: () => void;
  onToggleSource: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onExportAnnotated: () => void;
  onPrint: () => void;
  onToggleCompare: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onAppearance: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onToggleRail: () => void;
  onToggleNotes: () => void;
  onRevealInFolder: () => void;
}

/** What a command is allowed to be offered for. */
export interface PaletteState {
  hasDocument: boolean;
  /** A read-only document has no caret, so editing commands are not offered —
   *  the same gate the keyboard shortcuts apply, for the same reason. */
  editable: boolean;
  sourceMode: boolean;
  /** Whether the comparison pane is showing a second document, which decides
   *  whether the one row offers to open it or to close it. */
  compareOpen: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  railCollapsed: boolean;
  /** Whether the notes panel is open, which decides which way the one row
   *  reads — the same arrangement as the sidebar's. */
  notesOpen: boolean;
  /** `⌘` on macOS, `Ctrl` everywhere else. */
  mod: string;
}

export function commandItems(actions: PaletteActions, state: PaletteState): PaletteItem[] {
  const { mod } = state;

  const all: (PaletteItem & { when?: boolean })[] = [
    {
      id: "cmd:open-file",
      label: "Open file…",
      chord: `${mod}+O`,
      keywords: "document markdown browse",
      group: "Commands",
      run: actions.onOpenFile,
    },
    {
      id: "cmd:open-folder",
      label: "Open folder…",
      chord: `${mod}+Shift+O`,
      keywords: "directory workspace project",
      group: "Commands",
      run: actions.onOpenFolder,
    },
    {
      id: "cmd:new-tab",
      label: "New tab",
      chord: `${mod}+T`,
      group: "Commands",
      run: actions.onNewTab,
    },
    {
      id: "cmd:close-tab",
      label: "Close tab",
      chord: `${mod}+W`,
      group: "Commands",
      when: state.hasDocument,
      run: actions.onCloseTab,
    },
    {
      id: "cmd:reopen-tab",
      label: "Reopen closed tab",
      chord: `${mod}+Shift+T`,
      keywords: "undo close restore",
      group: "Commands",
      run: actions.onReopenTab,
    },
    {
      id: "cmd:next-tab",
      label: "Next tab",
      chord: `${mod}+Tab`,
      group: "Commands",
      when: state.hasDocument,
      run: () => {
        actions.onCycleTab(1);
      },
    },
    {
      id: "cmd:previous-tab",
      label: "Previous tab",
      chord: `${mod}+Shift+Tab`,
      group: "Commands",
      when: state.hasDocument,
      run: () => {
        actions.onCycleTab(-1);
      },
    },
    {
      id: "cmd:back",
      label: "Back",
      chord: `${mod}+[`,
      keywords: "history previous",
      group: "Commands",
      when: state.canGoBack,
      run: actions.onBack,
    },
    {
      id: "cmd:forward",
      label: "Forward",
      chord: `${mod}+]`,
      keywords: "history next",
      group: "Commands",
      when: state.canGoForward,
      run: actions.onForward,
    },
    {
      id: "cmd:find",
      label: "Find in document",
      chord: `${mod}+F`,
      keywords: "search",
      group: "Commands",
      when: state.hasDocument,
      run: actions.onFind,
    },
    {
      id: "cmd:toggle-source",
      label: state.sourceMode ? "Show the rendered document" : "Edit as Markdown",
      chord: `${mod}+E`,
      keywords: "source raw text",
      group: "Commands",
      when: state.editable,
      run: actions.onToggleSource,
    },
    {
      id: "cmd:undo",
      label: "Undo",
      chord: `${mod}+Z`,
      group: "Commands",
      when: state.editable,
      run: actions.onUndo,
    },
    {
      id: "cmd:redo",
      label: "Redo",
      chord: `${mod}+Shift+Z`,
      group: "Commands",
      when: state.editable,
      run: actions.onRedo,
    },
    {
      id: "cmd:export",
      label: "Export as HTML…",
      chord: `${mod}+Shift+E`,
      keywords: "save share standalone",
      group: "Commands",
      when: state.hasDocument,
      run: actions.onExport,
    },
    {
      id: "cmd:export-annotated",
      label: "Export with notes…",
      // No chord. Every modifier is spoken for, and a command reached from the
      // panel it belongs to does not need one — see the chord table's own note
      // about a row advertising something nothing binds.
      keywords: "annotations highlights marks markdown copy save",
      group: "Commands",
      when: state.hasDocument,
      run: actions.onExportAnnotated,
    },
    {
      id: "cmd:print",
      label: "Print or save as PDF…",
      chord: `${mod}+P`,
      keywords: "export paper",
      group: "Commands",
      when: state.hasDocument,
      run: actions.onPrint,
    },
    {
      // One row rather than an open/close pair, because the chord is a toggle
      // and a palette that offers "Close…" while the pane is shut is offering a
      // row that does nothing.
      id: "cmd:compare",
      label: state.compareOpen ? "Close the comparison pane" : "Compare with another file…",
      chord: `${mod}+\\`,
      keywords: "split side by side second pane diff",
      group: "Commands",
      run: actions.onToggleCompare,
    },
    {
      id: "cmd:reveal",
      label: "Reveal in file manager",
      keywords: "explorer finder folder show",
      group: "Commands",
      when: state.hasDocument,
      run: actions.onRevealInFolder,
    },
    {
      id: "cmd:zoom-in",
      label: "Zoom in",
      chord: `${mod}++`,
      keywords: "bigger text size",
      group: "Commands",
      run: actions.onZoomIn,
    },
    {
      id: "cmd:zoom-out",
      label: "Zoom out",
      chord: `${mod}+−`,
      keywords: "smaller text size",
      group: "Commands",
      run: actions.onZoomOut,
    },
    {
      id: "cmd:zoom-reset",
      label: "Reset zoom",
      chord: `${mod}+0`,
      group: "Commands",
      run: actions.onZoomReset,
    },
    {
      id: "cmd:rail",
      label: state.railCollapsed ? "Show the sidebar" : "Hide the sidebar",
      keywords: "rail outline tree toggle",
      group: "Commands",
      run: actions.onToggleRail,
    },
    {
      id: "cmd:notes",
      label: state.notesOpen ? "Hide notes" : "Show notes",
      chord: `${mod}+Shift+A`,
      // "annotation" and "highlight" are what a reader would type; the panel is
      // called Notes because that is what is in it once they have written one.
      keywords: "notes annotations highlights marks panel",
      group: "Commands",
      run: actions.onToggleNotes,
    },
    {
      id: "cmd:appearance",
      label: "Appearance…",
      chord: `${mod}+Shift+,`,
      keywords: "theme typography colours spacing",
      group: "Commands",
      run: actions.onAppearance,
    },
    {
      id: "cmd:settings",
      label: "Settings…",
      chord: `${mod}+,`,
      keywords: "preferences options",
      group: "Commands",
      run: actions.onSettings,
    },
    {
      id: "cmd:about",
      label: "About lindo-md",
      keywords: "version shortcuts help",
      group: "Commands",
      run: actions.onAbout,
    },
  ];

  return all.filter((item) => item.when !== false).map(({ when: _when, ...item }) => item);
}
