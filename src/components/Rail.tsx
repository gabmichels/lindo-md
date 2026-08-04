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
  Share,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Heading, TreeNode } from "@/lib/ipc";
import { ancestorsOf } from "@/hooks/useFileTree";
import { basename, cn } from "@/lib/utils";

/**
 * The Studio Rail: the tool, in its own constant dark material, against whatever
 * paper the document theme is showing.
 *
 * Reads only `--ui-*` tokens — never a `--doc-*` one. That is what keeps the
 * tool looking like the same object while the document changes underneath it
 * (DESIGN.md).
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
  toc: Heading[];
  activeHeadingId: string | null;
  progress: number;
  onJumpTo: (id: string) => void;
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
        <RailIconButton
          label="Appearance settings"
          icon={Palette}
          onClick={props.onOpenSettings}
        />
        <RailIconButton
          label="Export as HTML"
          icon={Share}
          onClick={props.onExport}
        />
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

      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--ui-pad)] pb-2">
        {props.tree.length > 0 && (
          <FileTree
            nodes={props.tree}
            activePath={props.activePath}
            openPaths={props.openPaths}
            onOpen={props.onOpen}
          />
        )}

        {props.toc.length > 0 && (
          <>
            {props.tree.length > 0 && (
              <div className="my-2 h-px bg-ui-hairline" aria-hidden />
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
        <RailIconButton
          label="Appearance settings"
          icon={Palette}
          onClick={props.onOpenSettings}
        />
        <RailIconButton
          label="Export as HTML"
          icon={Share}
          onClick={props.onExport}
        />
        <RailIconButton label="About lindo-md" icon={Info} onClick={props.onOpenAbout} />
      </div>
    </nav>
  );
}

function FolderChip({
  folder,
  onPick,
}: {
  folder: string | null;
  onPick: () => void;
}) {
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
      <span className="truncate">
        {folder ? basename(folder) : "Open a folder"}
      </span>
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
  return (
    <div
      className="drag-region h-[var(--ui-titlebar-h)] shrink-0"
      aria-hidden
    />
  );
}

function FileTree({
  nodes,
  activePath,
  openPaths,
  onOpen,
}: {
  nodes: TreeNode[];
  activePath: string | null;
  openPaths: Set<string>;
  onOpen: (path: string, permanent: boolean) => void;
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

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <div className="pt-1">
      <p className="rail-label px-1.5 py-1">Documents</p>
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
    <li role="treeitem" aria-expanded={node.isDir ? isOpen : undefined}>
      <button
        type="button"
        // A single click previews — it reuses one tab, so browsing a folder does
        // not leave a trail behind. Double-click, Ctrl+click and middle-click all
        // mean "keep this one", which is the gesture set a file tree teaches.
        onClick={(event) =>
          node.isDir
            ? onToggle(node.path)
            : onOpen(node.path, event.ctrlKey || event.metaKey)
        }
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
            ? "bg-ui-ember-wash text-ui-text-strong"
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
            className={cn("ml-[14px] shrink-0", isActive && "text-ui-ember")}
            aria-hidden
          />
        )}
        <span className="truncate">{node.name}</span>
        {/* Open, but not the tab you are looking at. A dot rather than the Ember
            wash: only one file at a time is actually being read. */}
        {hasTab && !isActive && (
          <span
            aria-hidden
            className="ml-auto size-1.5 shrink-0 rounded-full bg-ui-text-faint"
          />
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
  const baseLevel = useMemo(
    () => Math.min(...toc.map((heading) => heading.level)),
    [toc],
  );

  return (
    <div className="relative pt-1">
      <p className="rail-label px-1.5 py-1">On this page</p>

      {/* The reading-progress hairline: the one place Ember appears next to the
          document rather than in the tool. */}
      <div className="absolute top-8 bottom-0 left-[3px] w-px bg-ui-hairline" aria-hidden>
        <div
          className="w-px bg-ui-ember transition-[height] duration-[var(--ui-dur)] ease-[var(--ui-ease)]"
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
                onClick={() => onJumpTo(heading.id)}
                title={heading.text}
                className={cn(
                  "w-full truncate rounded-ui-md px-1.5 py-1 text-left text-[12.5px]",
                  "transition-colors duration-[var(--ui-dur)]",
                  isActive
                    ? "text-ui-text-strong"
                    : "text-ui-text-muted hover:text-ui-text",
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
