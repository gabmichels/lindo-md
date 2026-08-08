import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Heading, TreeNode } from "@/lib/ipc";
import {
  commandItems,
  fileItems,
  headingItems,
  parseQuery,
  rank,
  recentItems,
  tabItems,
  themeItems,
  type PaletteActions,
  type PaletteItem,
  type PaletteMode,
  type PaletteResult,
  type PaletteState,
} from "@/lib/palette/items";
import { PRESETS } from "@/lib/theme/presets";
import type { Theme } from "@/lib/theme/schema";
import { cn } from "@/lib/utils";

/**
 * One box for everything the app can be asked to do or shown.
 *
 * Two things about the shape are deliberate. The list is **flat and ranked**,
 * never sectioned: a quick-open that files the best match under a heading has
 * hidden the answer it just found. And the sources are chosen by a **prefix**
 * rather than by separate shortcuts — `>` for commands, `@` for headings, and
 * nothing for documents — because that is the vocabulary readers arrive with
 * from Sublime, and because it means one chord to remember instead of three.
 *
 * Every row that has a keyboard chord shows it. For most people this dialog is
 * the only place they will ever learn one.
 */

/** Enough rows to be worth scrolling, few enough to stay a list rather than a
 *  file tree with a search box. */
const MAX_RESULTS = 50;

const PLACEHOLDER: Record<PaletteMode, string> = {
  open: "Search files, recents and open tabs…",
  commands: "Run a command or switch theme…",
  headings: "Jump to a heading…",
};

export interface CommandPaletteProps {
  /** `">"` opens straight into command mode; `""` into quick-open. */
  initialQuery: string;
  onClose: () => void;
  actions: PaletteActions;
  state: PaletteState;
  tabs: readonly { id: string; path: string }[];
  activeTabId: string | null;
  onActivateTab: (id: string) => void;
  recentFiles: readonly string[];
  openPaths: ReadonlySet<string>;
  onOpenPath: (path: string) => void;
  tree: TreeNode[];
  folder: string | null;
  toc: readonly Heading[];
  onJumpTo: (id: string) => void;
  customThemes: readonly Theme[];
  onPickTheme: (id: string) => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [raw, setRaw] = useState(props.initialQuery);
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const { mode, query } = parseQuery(raw);

  /**
   * Rebuilt and re-ranked on every render, deliberately.
   *
   * This was a `useMemo` over a hand-written dependency list, and it was correct
   * only by accident: every row closes over shell state — `onBack` reaches
   * `runtime`, `onExport` reaches `scroller` and `theme` — and none of that is
   * in `PaletteState`. What kept the closures fresh was that `useTabDocuments`
   * returns a bare object literal, so `state` changed identity every render and
   * the memo never held. Memoizing that unrelated hook, an obvious performance
   * fix in a file that already imports `useMemo`, would have started serving
   * stale actions from a list that looked right.
   *
   * The memo was buying nothing anyway: it invalidated on every render. Ranking
   * five thousand candidates measures 0.6 ms, and this only renders on a
   * keystroke or an arrow key, so the honest version is also the fast one.
   */
  const items = buildItems(mode, props);
  const results = rank(items, query, MAX_RESULTS);
  const current = results[selected];

  // A new query is a new list, and keeping the old index would leave the
  // highlight on whatever happened to land in that position.
  useEffect(() => {
    setSelected(0);
  }, [raw]);

  useEffect(() => {
    // After Radix's own focus scope has run, so it is this that wins.
    const frame = requestAnimationFrame(() => {
      const field = input.current;
      if (!field) return;
      field.focus();
      // Chromium selects the whole value when an input is focused from script,
      // so the `>` this opens with would be replaced by the first character
      // typed — Ctrl+Shift+P then "theme" would land in quick-open, searching
      // for a file called theme. The caret goes after the prefix instead.
      field.setSelectionRange(field.value.length, field.value.length);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [selected, results]);

  const run = (result: PaletteResult | undefined) => {
    if (!result) return;
    // Closed first, so a command that opens another dialog is not fighting this
    // one for focus.
    props.onClose();
    result.item.run();
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed top-[12vh] left-1/2 z-50 flex w-[min(560px,90vw)] -translate-x-1/2 flex-col",
            "overflow-hidden rounded-ui-lg bg-ui-plane-1 shadow-2xl",
          )}
          onKeyDown={(event) => {
            // The window-level shortcuts are suspended while this is open (see
            // `App.tsx`), so every key it wants is handled here.
            if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
              event.preventDefault();
              setSelected((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
            } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
              event.preventDefault();
              setSelected((index) =>
                results.length === 0 ? 0 : (index - 1 + results.length) % results.length,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(current);
            } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
              // The chord that opened it closes it, which is what a toggle
              // means to the fingers that pressed it.
              event.preventDefault();
              props.onClose();
            } else if ((event.ctrlKey || event.metaKey) && event.key === "P") {
              // Ctrl+Shift+P with the box already open switches it to commands
              // rather than doing nothing: reaching for the chord you know is
              // not a mistake to be ignored. Matched on the capital `P`, since
              // Shift changes the character rather than only setting the flag —
              // the unshifted `p` is the emacs-style "previous row" above.
              event.preventDefault();
              setRaw((value) => (value.startsWith(">") ? value : ">"));
            }
          }}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>

          {/* Focused explicitly rather than with `autoFocus`: the rule against
              that prop is about pages, and this is a modal whose only purpose
              is the field — but Radix's focus scope would otherwise land on the
              content box, where typing goes nowhere. */}
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            // Keyed off the row's position, never its id: a file row's id
            // carries the filesystem path, and `C:\Users\gab\My Documents\x.md`
            // is an ordinary one. An HTML id may not contain whitespace and
            // `aria-activedescendant` is a whitespace-delimited IDREF, so the
            // reference would silently resolve to nothing and a screen reader
            // would announce no selection while everything visual kept working.
            aria-activedescendant={current ? `palette-row-${selected}` : undefined}
            aria-label={PLACEHOLDER[mode]}
            placeholder={PLACEHOLDER[mode]}
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
            }}
            className={cn(
              "w-full bg-transparent px-4 py-3 text-[13.5px] text-ui-text-strong",
              "placeholder:text-ui-text-faint focus:outline-none",
            )}
          />

          <div className="h-px shrink-0 bg-ui-hairline" />

          <div
            ref={list}
            id="palette-results"
            role="listbox"
            aria-label="Results"
            className="max-h-[46vh] overflow-y-auto p-1"
          >
            {results.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12.5px] text-ui-text-faint">
                {items.length === 0 ? emptySource(mode) : "No matches"}
              </p>
            ) : (
              results.map((result, index) => (
                <Row
                  key={result.item.id}
                  index={index}
                  result={result}
                  selected={index === selected}
                  onSelect={() => {
                    setSelected(index);
                  }}
                  onRun={() => {
                    run(result);
                  }}
                />
              ))
            )}
          </div>

          <div
            className={cn(
              "flex shrink-0 items-center gap-3 border-t border-ui-hairline px-4 py-2",
              "text-[11px] text-ui-text-faint",
            )}
          >
            <Hint prefix=">" label="commands" />
            <Hint prefix="@" label="headings" />
            <span className="ml-auto">↑↓ to move · ↵ to run · esc to close</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Hint({ prefix, label }: { prefix: string; label: string }) {
  return (
    <span>
      <span className="text-ui-text-muted">{prefix}</span> {label}
    </span>
  );
}

/** Why a mode has nothing to offer, which is never the same as "no matches". */
function emptySource(mode: PaletteMode): string {
  if (mode === "headings") return "This document has no headings";
  if (mode === "commands") return "No commands";
  return "Nothing open yet — Ctrl / ⌘ + O opens a file";
}

function Row({
  index,
  result,
  selected,
  onSelect,
  onRun,
}: {
  index: number;
  result: PaletteResult;
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
}) {
  return (
    // The listbox is driven from the input, as a combobox must be: focus never
    // leaves the text field, so the row itself carries no key handler and the
    // rule has nothing real to object to.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard lives on the combobox input
    <div
      id={`palette-row-${index}`}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseMove={onSelect}
      onClick={onRun}
      className={cn(
        "flex cursor-default items-baseline gap-2 rounded-ui-sm px-3 py-1.5 text-[12.5px]",
        selected ? "bg-ui-ember-wash text-ui-text-strong" : "text-ui-text",
      )}
    >
      {/* `whitespace-pre` so a heading's indent survives — it is the outline's
          shape, and collapsing it makes every level look the same. */}
      <span className="min-w-0 shrink truncate whitespace-pre">
        <Marked text={result.item.label} ranges={result.labelRanges} />
      </span>
      {result.item.detail !== undefined && (
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ui-text-faint">
          <Marked text={result.item.detail} ranges={result.detailRanges} />
        </span>
      )}
      {result.item.chord !== undefined && (
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-ui-text-muted tabular-nums">
          {result.item.chord}
        </span>
      )}
    </div>
  );
}

/** The matched characters, marked so a reader can see *why* a row is here. */
function Marked({ text, ranges }: { text: string; ranges: [number, number][] }): ReactNode {
  if (ranges.length === 0) return text;

  const parts: ReactNode[] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <em key={from} className="text-ui-ember not-italic">
        {text.slice(from, to)}
      </em>,
    );
    at = to;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

function buildItems(mode: PaletteMode, props: CommandPaletteProps): PaletteItem[] {
  if (mode === "commands") {
    return [
      ...commandItems(props.actions, props.state),
      ...themeItems(PRESETS, props.customThemes, props.onPickTheme),
    ];
  }

  if (mode === "headings") return headingItems(props.toc, props.onJumpTo);

  const tabs = tabItems(props.tabs, props.activeTabId, props.onActivateTab);
  const recents = recentItems(props.recentFiles, props.openPaths, props.onOpenPath);
  // A file already offered as a tab or a recent is not offered a third time.
  const seen = new Set([...props.openPaths, ...props.recentFiles]);
  return [...tabs, ...recents, ...fileItems(props.tree, props.folder, seen, props.onOpenPath)];
}
