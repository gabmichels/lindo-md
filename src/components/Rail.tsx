import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Settings,
  Share,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Heading, TreeNode } from "@/lib/ipc";
import { ancestorsOf } from "@/hooks/useFileTree";
import { basename, cn, dragRegion } from "@/lib/utils";

/**
 * The Studio Rail: the tool, in its own material, against the paper the document
 * theme is showing.
 *
 * Reads only `--ui-*` tokens — never a `--doc-*` one. That rule outlived the
 * thing it was first written for. It used to keep the tool looking like the same
 * object while the document changed underneath it; now that `chrome.ts` derives
 * the `--ui-*` set from the active theme, the rail moves with the paper. What
 * the rule still buys is that it moves *as a material* — one derivation, applied
 * once — rather than by this component reaching into the page's palette and
 * picking a colour that suits it (DESIGN.md).
 */

interface RailProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  folder: string | null;
  onPickFolder: () => void;
  tree: TreeNode[];
  activePath: string | null;
  /** Every file with a tab open, so the tree can mark them without pretending
   *  they are all active. */
  openPaths: Set<string>;
  onOpen: (path: string, permanent: boolean) => void;
  /** The file tree folded away, leaving the outline the whole rail. */
  treeCollapsed: boolean;
  onToggleTreeCollapsed: () => void;
  toc: Heading[];
  activeHeadingId: string | null;
  progress: number;
  onJumpTo: (id: string) => void;
  onOpenAppearance: () => void;
  onOpenSettings: () => void;
  onExport: () => void;
  onOpenAbout: () => void;
}

export function Rail(props: RailProps) {
  if (props.collapsed) {
    return (
      <nav
        className="flex w-[var(--ui-rail-collapsed-w)] shrink-0 flex-col items-center gap-1 bg-ui-base py-2"
        aria-label="Tools"
      >
        <TopSpacer />
        <RailIconButton
          label="Expand sidebar"
          icon={PanelLeftOpen}
          onClick={props.onToggleCollapsed}
        />
        <div className="flex-1" />
        <RailIconButton label="Appearance" icon={Palette} onClick={props.onOpenAppearance} />
        <RailIconButton label="Settings" icon={Settings} onClick={props.onOpenSettings} />
        <RailIconButton label="Export as HTML" icon={Share} onClick={props.onExport} />
        <RailIconButton label="About lindo-md" icon={Info} onClick={props.onOpenAbout} />
      </nav>
    );
  }

  return (
    <nav
      className="flex shrink-0 flex-col bg-ui-base"
      style={{ width: "var(--ui-rail-w)" }}
      aria-label="Documents and outline"
    >
      <TopSpacer />

      <div className="flex h-[var(--ui-toolbar-h)] items-center gap-1 px-[var(--ui-pad)]">
        <FolderChip folder={props.folder} onPick={props.onPickFolder} />
        <RailIconButton
          label="Collapse sidebar"
          icon={PanelLeftClose}
          onClick={props.onToggleCollapsed}
        />
      </div>

      {/* Two panes, not one scroller. The tree is the elastic one: it gives up
          height first and scrolls inside itself, so the outline — which is about
          the document you are actually reading — never gets pushed out of the
          rail by a deep folder. */}
      <div className="flex min-h-0 flex-1 flex-col px-[var(--ui-pad)] pb-2">
        {props.tree.length > 0 && (
          <FileTree
            nodes={props.tree}
            activePath={props.activePath}
            openPaths={props.openPaths}
            onOpen={props.onOpen}
            collapsed={props.treeCollapsed}
            onToggleCollapsed={props.onToggleTreeCollapsed}
          />
        )}

        {props.toc.length > 0 && (
          <>
            {props.tree.length > 0 && (
              <div className="my-2 h-px shrink-0 bg-ui-hairline" aria-hidden />
            )}
            <Outline
              toc={props.toc}
              activeId={props.activeHeadingId}
              progress={props.progress}
              onJumpTo={props.onJumpTo}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-1 px-[var(--ui-pad)] pb-2">
        <RailIconButton label="Appearance" icon={Palette} onClick={props.onOpenAppearance} />
        <RailIconButton label="Settings" icon={Settings} onClick={props.onOpenSettings} />
        <RailIconButton label="Export as HTML" icon={Share} onClick={props.onExport} />
        <RailIconButton label="About lindo-md" icon={Info} onClick={props.onOpenAbout} />
      </div>
    </nav>
  );
}

function FolderChip({ folder, onPick }: { folder: string | null; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={folder ?? "Open a folder"}
      className={cn(
        "no-drag flex min-w-0 flex-1 items-center gap-1.5 rounded-ui-md px-1.5 py-1",
        "text-[12.5px] text-ui-text transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-1 hover:text-ui-text-strong",
      )}
    >
      <FolderOpen size={15} strokeWidth={1.5} className="shrink-0" aria-hidden />
      <span className="truncate">{folder ? basename(folder) : "Open a folder"}</span>
    </button>
  );
}

/**
 * Clears the titlebar band across the rail's full width.
 *
 * Load-bearing three times over: it keeps the rail's own rows aligned with the
 * toolbar across the canvas seam, it clears macOS's real traffic lights, and —
 * because it drags — it gives the window a grab handle on the left even when
 * the tab strip on the right is full.
 */
function TopSpacer() {
  return <div {...dragRegion("h-[var(--ui-titlebar-h)] shrink-0")} aria-hidden />;
}

/**
 * How much of the rail a section keeps when the other one wants everything.
 *
 * The two sections size themselves from their content and, when the rail cannot
 * hold both, shrink in proportion to it. Proportional shrink is right until one
 * side is much larger than the other, at which point it wipes the smaller one
 * out — a sixty-heading outline beside a six-file tree leaves the tree one row
 * and a scrollbar.
 *
 * So each section states a floor, and it is a measurement rather than a
 * percentage: `min` of its own content and four rows, so a section holding two
 * rows never reserves space it has nothing to put in.
 *
 * That last clause is the whole reason this exists. The outline used to carry a
 * flat `max-h-[60%]`, which is a floor for the tree written as a ceiling on the
 * outline — and a ceiling cannot tell whether the tree needs the room. It capped
 * the outline at 60% of the rail with the tree collapsed, with the tree empty,
 * and with a three-file tree that wanted 90px of it, leaving the outline
 * scrolling inside two thirds of a rail that was two thirds empty.
 */
const FLOOR_ROWS = 4;
/** A `rail-label` at 10.5px with its `py-1`. */
const LABEL_H = 22;
/** `--ui-row-h`, and the outline's shorter row: 12.5px text with `py-1`. Only a
 *  floor is computed from them, so they need to be close, not exact. */
const TREE_ROW_H = 30;
const OUTLINE_ROW_H = 26;

function floorFor(rows: number, rowHeight: number): number {
  return LABEL_H + Math.min(rows, FLOOR_ROWS) * rowHeight;
}

/** Rows the tree is actually drawing — a folded folder's children are not on
 *  screen and must not be counted into the space it asks for. */
function visibleRows(nodes: TreeNode[], expanded: Set<string>): number {
  let rows = 0;
  for (const node of nodes) {
    rows += 1;
    if (node.isDir && expanded.has(node.path)) rows += visibleRows(node.children, expanded);
    if (rows >= FLOOR_ROWS) return rows;
  }
  return rows;
}

function FileTree({
  nodes,
  activePath,
  openPaths,
  onOpen,
  collapsed,
  onToggleCollapsed,
}: {
  nodes: TreeNode[];
  activePath: string | null;
  openPaths: Set<string>;
  onOpen: (path: string, permanent: boolean) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Opening a document from a link — or from history — has to reveal it in the
  // tree, or the highlight sits inside a collapsed folder where nobody sees it.
  useEffect(() => {
    if (!activePath) return;
    const needed = ancestorsOf(nodes, activePath);
    if (needed.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const path of needed) next.add(path);
      return next;
    });
  }, [activePath, nodes]);

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };

  return (
    // `shrink` with no `flex-1`: the tree is sized by its content, and gives way
    // to its floor — never past it — when the rail runs out of room.
    <section
      className="flex min-h-0 shrink flex-col pt-1"
      style={{
        minHeight: collapsed ? LABEL_H : floorFor(visibleRows(nodes, expanded), TREE_ROW_H),
      }}
    >
      <SectionLabel label="Documents" collapsed={collapsed} onToggle={onToggleCollapsed} />
      {!collapsed && (
        <div className="ui-scroller min-h-0 overflow-y-auto">
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- ul/li carrying tree roles is the W3C APG pattern */}
          <ul role="tree">
            {nodes.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                activePath={activePath}
                openPaths={openPaths}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A rail section header that folds its section away. */
function SectionLabel({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
      className={cn(
        "rail-label flex w-full shrink-0 items-center gap-1 rounded-ui-sm px-1.5 py-1",
        "text-left transition-colors duration-[var(--ui-dur)] hover:text-ui-text",
      )}
    >
      {collapsed ? (
        <ChevronRight size={12} strokeWidth={2} aria-hidden />
      ) : (
        <ChevronDown size={12} strokeWidth={2} aria-hidden />
      )}
      {label}
    </button>
  );
}

function TreeItem({
  node,
  depth,
  expanded,
  onToggle,
  activePath,
  openPaths,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  activePath: string | null;
  openPaths: Set<string>;
  onOpen: (path: string, permanent: boolean) => void;
}) {
  const isOpen = expanded.has(node.path);
  const isActive = !node.isDir && node.path === activePath;
  const hasTab = !node.isDir && openPaths.has(node.path);

  return (
    // `aria-selected` is required on `treeitem` and was missing: a screen reader
    // announced the tree but never which file was open. `ul`/`li` carrying the tree
    // roles is the W3C APG pattern, which is what the disabled rule objects to.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- ul/li is the APG tree pattern
    <li role="treeitem" aria-expanded={node.isDir ? isOpen : undefined} aria-selected={isActive}>
      <button
        type="button"
        // A single click previews — it reuses one tab, so browsing a folder does
        // not leave a trail behind. Double-click, Ctrl+click and middle-click all
        // mean "keep this one", which is the gesture set a file tree teaches.
        onClick={(event) => {
          if (node.isDir) onToggle(node.path);
          else onOpen(node.path, event.ctrlKey || event.metaKey);
        }}
        onDoubleClick={() => {
          if (!node.isDir) onOpen(node.path, true);
        }}
        onAuxClick={(event) => {
          if (node.isDir || event.button !== 1) return;
          event.preventDefault();
          onOpen(node.path, true);
        }}
        title={node.name}
        className={cn(
          "flex h-[var(--ui-row-h)] w-full items-center gap-1.5 rounded-ui-md pr-1.5",
          "text-left text-[13px] transition-colors duration-[var(--ui-dur)]",
          isActive
            ? "bg-ui-accent-wash text-ui-text-strong"
            : "text-ui-text hover:bg-ui-plane-1 hover:text-ui-text-strong",
        )}
        // Indentation is inline because it is data, not a design decision — the
        // depth is not known until the tree is walked.
        style={{ paddingLeft: `${6 + depth * 12}px` }}
      >
        {node.isDir ? (
          <>
            {isOpen ? (
              <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" aria-hidden />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" aria-hidden />
            )}
            {isOpen ? (
              <FolderOpen size={14} strokeWidth={1.5} className="shrink-0" aria-hidden />
            ) : (
              <Folder size={14} strokeWidth={1.5} className="shrink-0" aria-hidden />
            )}
          </>
        ) : (
          <FileText
            size={14}
            strokeWidth={1.5}
            className={cn("ml-[14px] shrink-0", isActive && "text-ui-accent")}
            aria-hidden
          />
        )}
        <span className="truncate">{node.name}</span>
        {/* Open, but not the tab you are looking at. A dot rather than the accent
            wash: only one file at a time is actually being read. */}
        {hasTab && !isActive && (
          <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-ui-text-faint" />
        )}
      </button>

      {node.isDir && isOpen && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              activePath={activePath}
              openPaths={openPaths}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function Outline({
  toc,
  activeId,
  progress,
  onJumpTo,
}: {
  toc: Heading[];
  activeId: string | null;
  progress: number;
  onJumpTo: (id: string) => void;
}) {
  // Headings are indented relative to the shallowest one in the document, so a
  // file whose top level is h2 does not sit needlessly indented.
  const baseLevel = useMemo(() => Math.min(...toc.map((heading) => heading.level)), [toc]);

  return (
    // Content height, shrinking to its floor when the tree wants the rail too.
    // No ceiling: with the tree collapsed, short, or absent, the outline is what
    // the rail is for and it takes the whole thing.
    <section
      className="flex min-h-0 shrink flex-col pt-1"
      style={{ minHeight: floorFor(toc.length, OUTLINE_ROW_H) }}
    >
      <p className="rail-label shrink-0 px-1.5 py-1">On this page</p>

      <div className="ui-scroller relative min-h-0 overflow-y-auto">
        {/* The reading-progress hairline: the one place the accent appears next to the
            document rather than in the tool. It spans the list, so it scrolls
            with the headings it measures. */}
        <div className="absolute inset-y-0 left-[3px] w-px bg-ui-hairline" aria-hidden>
          <div
            className="w-px bg-ui-accent transition-[height] duration-[var(--ui-dur)] ease-[var(--ui-ease)]"
            style={{ height: `${Math.round(progress * 100)}%` }}
          />
        </div>

        <ul className="pl-2">
          {toc.map((heading) => {
            const isActive = heading.id === activeId;
            return (
              <li key={heading.id}>
                <button
                  type="button"
                  onClick={() => {
                    onJumpTo(heading.id);
                  }}
                  title={heading.text}
                  className={cn(
                    "w-full truncate rounded-ui-md px-1.5 py-1 text-left text-[12.5px]",
                    "transition-colors duration-[var(--ui-dur)]",
                    isActive ? "text-ui-text-strong" : "text-ui-text-muted hover:text-ui-text",
                  )}
                  style={{
                    paddingLeft: `${6 + (heading.level - baseLevel) * 10}px`,
                  }}
                >
                  {heading.text}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function RailIconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Info;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "no-drag grid size-7 shrink-0 place-items-center rounded-ui-sm",
        "text-ui-text-muted transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-1 hover:text-ui-text-strong",
      )}
    >
      <Icon size={15} strokeWidth={1.5} aria-hidden />
    </button>
  );
}
