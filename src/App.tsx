import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AboutDialog } from "@/components/AboutDialog";
import { DocumentDeck } from "@/components/DocumentDeck";
import { EmptyState } from "@/components/EmptyState";
import { FindBar } from "@/components/FindBar";
import { Rail } from "@/components/Rail";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { TabGroupDialog } from "@/components/TabGroupDialog";
import { TabStrip } from "@/components/TabStrip";
import { TitleBar } from "@/components/TitleBar";
import { Toolbar } from "@/components/Toolbar";
import { ConfigProvider, useConfig } from "@/hooks/useConfig";
import { useFileTree } from "@/hooks/useFileTree";
import { useFind } from "@/hooks/useFind";
import { useOutline } from "@/hooks/useOutline";
import { useTabDocuments } from "@/hooks/useTabDocuments";
import { useTabs } from "@/hooks/useTabs";
import { useTheme } from "@/hooks/useTheme";
import {
  getInitialDocument,
  onOpenDocumentRequested,
  writeHtmlFile,
} from "@/lib/ipc";
import { buildStandaloneHtml } from "@/lib/export/html";
import { stepZoom } from "@/lib/zoom";
import documentCss from "@/document.css?inline";
import { basename, dirname } from "@/lib/utils";

export default function App() {
  return (
    <ConfigProvider>
      <Shell />
    </ConfigProvider>
  );
}

function Shell() {
  const { config, loaded, update } = useConfig();

  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** The group whose name is being asked for, just after it was created. */
  const [namingGroup, setNamingGroup] = useState<string | null>(null);

  const [folder, setFolder] = useState<string | null>(null);
  /** Which tabs are showing their Markdown. Per tab, not per window: two tabs
   *  can be in different modes, and switching between them should not change
   *  what either was showing. */
  const [sourceTabs, setSourceTabs] = useState<ReadonlySet<string>>(new Set());
  const toggleSource = useCallback((tabId: string) => {
    setSourceTabs((current) => {
      const next = new Set(current);
      if (!next.delete(tabId)) next.add(tabId);
      return next;
    });
  }, []);

  const theme = useTheme(
    config.themeId,
    config.appearance,
    config.customThemes,
    canvas,
    config.zoom,
  );
  const { tree } = useFileTree(
    folder,
    config.respectGitignore,
    config.showHiddenFiles,
  );

  const tabs = useTabs();
  const { session } = tabs;
  const docs = useTabDocuments(session, folder);

  const active = session.activeTabId
    ? session.tabs.find((tab) => tab.id === session.activeTabId)
    : undefined;
  const runtime = active ? docs.runtimes[active.id] : undefined;
  const document = runtime?.document ?? null;

  // The active tab loads on demand rather than at restore time — see
  // `useTabDocuments` for why a ten-tab session must not open ten documents.
  const { hydrate } = docs;
  useEffect(() => {
    if (active) hydrate(active.id, active.path);
  }, [active, hydrate]);

  // The rail's folder: the one the reader last picked, or failing that the
  // directory of whatever tab is open. A restored session with an empty tree
  // beside it looks like the restore only half worked.
  useEffect(() => {
    if (!loaded) return;
    if (config.lastFolder) {
      setFolder(config.lastFolder);
      return;
    }
    if (active) setFolder((current) => current ?? dirname(active.path));
  }, [loaded, config.lastFolder, active]);

  const outline = useOutline(document?.toc ?? [], scroller);
  const find = useFind(scroller);

  // Find highlights are ranges into the DOM of one document, so they cannot
  // survive a switch to another tab's DOM.
  useEffect(() => {
    find.clear();
    setFindOpen(false);
    // Only when the tab changes; re-running on every `find` identity would
    // clear the query as the reader types it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.activeTabId]);

  const openPaths = useMemo(
    () => new Set(session.tabs.map((tab) => tab.path)),
    [session.tabs],
  );

  const openInTab = useCallback(
    (path: string, permanent: boolean) => {
      if (!folder) setFolder(dirname(path));
      tabs.open(path, { preview: !permanent });
    },
    [folder, tabs],
  );

  // A document handed to us by the OS — a double-clicked `.md`, or a second
  // launch routed here by the single-instance plugin. It always earns a real
  // tab: the reader asked for this file by name.
  const openFromOs = useCallback(
    (path: string) => {
      setFolder((current) => current ?? dirname(path));
      tabs.open(path);
    },
    [tabs],
  );

  // Waits for the config: the session is restored from it, and opening on top
  // of a restore is the only order that keeps both the saved tabs and this one.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (!loaded || openedInitial.current) return;
    openedInitial.current = true;

    // "Reopen last document" is now the tab session coming back, restored in
    // `useTabs`; all that is left here is the file the OS handed us, which
    // always wins because the reader asked for that one by name.
    getInitialDocument().then(
      (path) => {
        if (path) openFromOs(path);
      },
      () => undefined,
    );
  }, [loaded, openFromOs]);

  useEffect(() => {
    const unlisten = onOpenDocumentRequested(openFromOs);
    return () => {
      void unlisten.then((off) => off());
    };
  }, [openFromOs]);

  const openFile = useCallback(async () => {
    const path = await openDialog({
      multiple: false,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] },
      ],
    });
    if (typeof path !== "string") return;
    // Opening a loose file also gives the rail something to show, which is more
    // useful than an empty tree next to an open document.
    if (!folder) setFolder(dirname(path));
    tabs.open(path);
  }, [folder, tabs]);

  const openFolder = useCallback(async () => {
    const path = await openDialog({ directory: true, multiple: false });
    if (typeof path !== "string") return;
    setFolder(path);
    update({ lastFolder: path });
  }, [update]);

  const exportHtml = useCallback(async () => {
    const article = scroller?.querySelector<HTMLElement>(".doc");
    if (!document || !article) return;

    const path = await saveDialog({
      title: "Export as HTML",
      defaultPath: `${document.title}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!path) return;

    await writeHtmlFile(
      path,
      buildStandaloneHtml({
        title: document.title,
        theme,
        article,
        documentCss,
      }),
    );
  }, [document, scroller, theme]);

  /**
   * Following a link inside a tab.
   *
   * A link to a file that already has its own tab activates that tab rather
   * than opening it twice — one document showing the same bytes in two places
   * helps nobody, and both copies would fight over the same live-reload.
   */
  const followLink = useCallback(
    (tabId: string, path: string, fragment: string) => {
      const elsewhere = session.tabs.find(
        (tab) => tab.path === path && tab.id !== tabId,
      );
      if (elsewhere) {
        tabs.activate(elsewhere.id);
        return;
      }
      tabs.setPath(tabId, path);
      tabs.promote(tabId);
      docs.navigate(tabId, path, fragment || undefined);
    },
    [docs, session.tabs, tabs],
  );

  // Back and forward walk the active tab's own history, so the tab has to be
  // re-pointed at whatever the step lands on.
  const step = useCallback(
    (delta: number) => {
      if (!active || !runtime) return;
      const path = runtime.history[runtime.cursor + delta];
      if (!path) return;
      tabs.setPath(active.id, path);
      if (delta < 0) docs.back(active.id);
      else docs.forward(active.id);
    },
    [active, runtime, docs, tabs],
  );

  // Computed from the current value at apply time, not from this render's — a
  // held Ctrl+`+` fires faster than React re-renders.
  const zoomBy = useCallback(
    (delta: number) =>
      update((current) => ({ zoom: stepZoom(current.zoom, delta) })),
    [update],
  );

  useKeyboardShortcuts({
    scroller,
    onFind: () => setFindOpen(true),
    onCloseFind: () => setFindOpen(false),
    onToggleSource: () => active && toggleSource(active.id),
    onUndo: () => active && docs.undoEdit(active.id),
    onRedo: () => active && docs.redoEdit(active.id),
    onOpenFile: () => void openFile(),
    onOpenFolder: () => void openFolder(),
    onSettings: () => setSettingsOpen((open) => !open),
    onAppearance: () => setAppearanceOpen((open) => !open),
    onZoomIn: () => zoomBy(0.1),
    onZoomOut: () => zoomBy(-0.1),
    onZoomReset: () => update({ zoom: 1 }),
    onPrint: () => window.print(),
    onExport: () => void exportHtml(),
    onBack: () => step(-1),
    onForward: () => step(1),
    onNewTab: () => void openFile(),
    onCloseTab: () => {
      if (active) tabs.close(active.id);
    },
    onCycleTab: (delta) => tabs.cycle(delta),
    onSelectTab: (index) => tabs.activateIndex(index),
    onReopenTab: () => tabs.reopenClosed(),
    onMoveTab: (delta) => {
      if (!active) return;
      const index = session.tabs.findIndex((tab) => tab.id === active.id);
      if (index < 0) return;
      // A seam past the neighbour on that side; the tab is lifted out before it
      // is re-inserted, so moving right needs to clear two positions.
      tabs.move(active.id, delta > 0 ? index + 2 : index - 1);
    },
  });

  const jumpTo = useCallback(
    (id: string) => {
      const target = scroller?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (target && scroller) {
        scroller.scrollTo({
          top: Math.max(0, target.offsetTop - 24),
          behavior: "smooth",
        });
      }
    },
    [scroller],
  );

  return (
    <div className="flex h-full">
      <Rail
        collapsed={config.railCollapsed}
        onToggleCollapsed={() => update({ railCollapsed: !config.railCollapsed })}
        folder={folder}
        onPickFolder={() => void openFolder()}
        tree={tree}
        activePath={active?.path ?? null}
        openPaths={openPaths}
        onOpen={openInTab}
        toc={document?.toc ?? []}
        activeHeadingId={outline.activeId}
        progress={outline.progress}
        onJumpTo={jumpTo}
        onOpenAppearance={() => setAppearanceOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onExport={() => void exportHtml()}
        onOpenAbout={() => setAboutOpen(true)}
      />

      {/* The canvas: everything inside it is styled by --doc-* tokens, which
          `useTheme` writes onto this element and nowhere else.

          `canvas-edge` is load-bearing rather than decorative: a dark document
          theme can land within a few percent of the rail's own value, and
          without an explicit edge the two planes merge into one surface and the
          whole tool/paper distinction disappears. */}
      <main
        ref={setCanvas}
        className="canvas-edge relative flex min-w-0 flex-1 flex-col bg-doc-bg"
      >
        <TitleBar>
          <TabStrip
            session={session}
            onActivate={tabs.activate}
            onClose={tabs.close}
            onNewTab={() => void openFile()}
            onToggleGroup={(groupId) => {
              const group = session.groups.find((candidate) => candidate.id === groupId);
              if (group) tabs.setGroupCollapsed(groupId, !group.collapsed);
            }}
            onReorder={tabs.move}
            onReorderGroup={tabs.moveGroup}
            onCloseOthers={tabs.closeOthers}
            onCloseToRight={tabs.closeToRight}
            onRemoveFromGroup={tabs.removeFromGroup}
            onNewGroup={(id) => setNamingGroup(tabs.group([id]))}
            onAddToGroup={tabs.addToGroup}
            onRenameGroup={setNamingGroup}
            onUngroup={tabs.ungroup}
            onCloseGroup={tabs.closeGroup}
            onRevealInFolder={(id) => {
              const tab = session.tabs.find((candidate) => candidate.id === id);
              if (tab) void revealItemInDir(tab.path).catch(() => undefined);
            }}
          />
        </TitleBar>

        <Toolbar
          breadcrumb={
            document
              ? {
                  folder: folder ? basename(folder) : null,
                  name: document.name,
                }
              : null
          }
          path={document?.path ?? null}
          sourceMode={active ? sourceTabs.has(active.id) : false}
          onToggleSource={() => active && toggleSource(active.id)}
          canGoBack={active ? docs.canGoBack(active.id) : false}
          canGoForward={active ? docs.canGoForward(active.id) : false}
          onBack={() => step(-1)}
          onForward={() => step(1)}
          onFind={() => setFindOpen(true)}
          onAppearance={() => setAppearanceOpen(true)}
        />

        {findOpen && (
          <FindBar
            find={find}
            onClose={() => {
              find.clear();
              setFindOpen(false);
            }}
          />
        )}

        <div className="relative min-h-0 flex-1">
          {runtime?.error ? (
            <Message text={runtime.error} />
          ) : session.tabs.length === 0 ? (
            <EmptyState
              recentFiles={config.recentFiles}
              onOpenFile={() => void openFile()}
              onOpenFolder={() => void openFolder()}
              onOpenRecent={(path) => tabs.open(path)}
            />
          ) : (
            <DocumentDeck
              session={session}
              runtimes={docs.runtimes}
              theme={theme}
              blockRemoteImages={config.blockRemoteImages}
              onOpenDocument={followLink}
              onAnchorConsumed={docs.clearPendingAnchor}
              onScrollChange={docs.rememberScroll}
              onScrollerReady={setScroller}
              onSave={docs.save}
              sourceTabs={sourceTabs}
              onToggleSource={toggleSource}
            />
          )}
        </div>
      </main>

      <TabGroupDialog
        group={
          namingGroup
            ? (session.groups.find((group) => group.id === namingGroup) ?? null)
            : null
        }
        onOpenChange={(open) => {
          if (!open) setNamingGroup(null);
        }}
        onRename={(name) => {
          if (namingGroup) tabs.renameGroup(namingGroup, name);
        }}
        onRecolor={(color) => {
          if (namingGroup) tabs.recolorGroup(namingGroup, color);
        }}
      />

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config}
        onUpdateConfig={update}
        onOpenAppearance={() => setAppearanceOpen(true)}
      />

      <SettingsDrawer
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
        config={config}
        theme={theme}
        onUpdateConfig={update}
      />
    </div>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="grid h-full place-items-center bg-doc-bg p-8">
      <p className="max-w-md text-center font-doc text-doc-text-muted">{text}</p>
    </div>
  );
}

/**
 * The app's keyboard surface, in one place.
 *
 * Registered on `window` rather than on a focused element: a reader scrolling
 * with the keyboard has focus on the document, and Ctrl+F has to work from
 * anywhere in the window.
 */
function useKeyboardShortcuts(handlers: {
  /** Scrolled by the paging keys, so a reader never has to click the document
   *  first — and so we do not have to auto-focus it and paint a focus ring
   *  around every page. */
  scroller: HTMLElement | null;
  onFind: () => void;
  onCloseFind: () => void;
  onToggleSource: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSettings: () => void;
  onAppearance: () => void;
  onPrint: () => void;
  onExport: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onBack: () => void;
  onForward: () => void;
  onNewTab: () => void;
  onCloseTab: () => void;
  onCycleTab: (delta: number) => void;
  onSelectTab: (index: number | "last") => void;
  onReopenTab: () => void;
  onMoveTab: (delta: number) => void;
}) {
  // The handlers object is rebuilt on every render, so it is held in a ref: the
  // listener is attached once and always calls the current version.
  const current = useRef(handlers);
  current.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const handlers = current.current;

      if (event.key === "Escape") {
        handlers.onCloseFind();
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) {
        // Typing in the find box or any other field must not scroll the page.
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, [contenteditable]")) return;
        scrollByKey(event, handlers.scroller);
        return;
      }

      // Ctrl+Shift+PageUp/PageDown moves the active tab, so reordering has a
      // keyboard path and is not something only a pointer can do.
      if (event.shiftKey && (event.key === "PageUp" || event.key === "PageDown")) {
        event.preventDefault();
        handlers.onMoveTab(event.key === "PageDown" ? 1 : -1);
        return;
      }

      // Ctrl+Tab cycles tabs; Ctrl+Shift+Tab goes the other way.
      if (event.key === "Tab") {
        event.preventDefault();
        handlers.onCycleTab(event.shiftKey ? -1 : 1);
        return;
      }

      // Ctrl+1..8 select that tab, Ctrl+9 the last one, as in every browser.
      // Ctrl+0 is zoom reset and falls through to the switch below.
      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        handlers.onSelectTab(event.key === "9" ? "last" : Number(event.key) - 1);
        return;
      }

      switch (event.key.toLowerCase()) {
        // The document cancels every input event, so the browser's own undo
        // stack never sees an edit. Without these two, Ctrl+Z does nothing at
        // all on a view whose whole job is changing files.
        case "z":
          event.preventDefault();
          if (event.shiftKey) handlers.onRedo();
          else handlers.onUndo();
          break;
        case "y":
          event.preventDefault();
          handlers.onRedo();
          break;
        // Ctrl+E and Ctrl+Shift+E both used to be spelled `case "e"`, and a
        // switch takes the first match, so export was unreachable while the
        // About dialog advertised it. Toggling the source keeps the bare
        // chord because that is what v1.0.0 shipped and readers have it in
        // their fingers; export moves to the shifted one.
        case "e":
          event.preventDefault();
          if (event.shiftKey) handlers.onExport();
          else handlers.onToggleSource();
          break;
        case "f":
          event.preventDefault();
          handlers.onFind();
          break;
        case "o":
          event.preventDefault();
          if (event.shiftKey) handlers.onOpenFolder();
          else handlers.onOpenFile();
          break;
        // Shift does not just set `shiftKey` for punctuation — it changes the
        // character, so `Ctrl+Shift+,` arrives as `<` on a US layout and testing
        // `shiftKey` alone would never match.
        case ",":
          event.preventDefault();
          handlers.onSettings();
          break;
        case "<":
          event.preventDefault();
          handlers.onAppearance();
          break;
        // Both the unshifted and shifted spellings of the zoom keys: on a US
        // layout Ctrl and `+` means Ctrl+Shift+`=`, and reporting differs
        // between layouts and browsers.
        case "=":
        case "+":
          event.preventDefault();
          handlers.onZoomIn();
          break;
        case "-":
        case "_":
          event.preventDefault();
          handlers.onZoomOut();
          break;
        case "0":
          event.preventDefault();
          handlers.onZoomReset();
          break;
        case "p":
          event.preventDefault();
          handlers.onPrint();
          break;
        case "t":
          event.preventDefault();
          if (event.shiftKey) handlers.onReopenTab();
          else handlers.onNewTab();
          break;
        case "w":
          event.preventDefault();
          handlers.onCloseTab();
          break;
        case "[":
          event.preventDefault();
          handlers.onBack();
          break;
        case "]":
          event.preventDefault();
          handlers.onForward();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** One page is a screen less two lines of overlap, so the reader keeps their
 *  place across the jump instead of having to find it again. */
function scrollByKey(event: KeyboardEvent, scroller: HTMLElement | null): void {
  if (!scroller) return;
  const page = scroller.clientHeight * 0.9;

  const delta = {
    PageDown: page,
    PageUp: -page,
    " ": event.shiftKey ? -page : page,
    ArrowDown: 60,
    ArrowUp: -60,
  }[event.key];

  if (delta !== undefined) {
    event.preventDefault();
    scroller.scrollBy({ top: delta, behavior: "instant" });
    return;
  }

  if (event.key === "Home") {
    event.preventDefault();
    scroller.scrollTo({ top: 0, behavior: "smooth" });
  } else if (event.key === "End") {
    event.preventDefault();
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }
}
