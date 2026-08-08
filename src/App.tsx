import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AboutDialog } from "@/components/AboutDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { CompareBar, ComparePane } from "@/components/ComparePane";
import { DocumentDeck } from "@/components/DocumentDeck";
import { DropOverlay } from "@/components/DropOverlay";
import { EmptyState } from "@/components/EmptyState";
import { FindBar } from "@/components/FindBar";
import { Rail } from "@/components/Rail";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { TabGroupDialog } from "@/components/TabGroupDialog";
import { TabStrip } from "@/components/TabStrip";
import { TitleBar } from "@/components/TitleBar";
import { Toolbar } from "@/components/Toolbar";
import { UpdateDialog } from "@/components/Updates";
import { ConfigProvider, useConfig } from "@/hooks/useConfig";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useFileTree } from "@/hooks/useFileTree";
import { useFind } from "@/hooks/useFind";
import { useHostPlatform } from "@/hooks/useHostPlatform";
import { useOsDocuments } from "@/hooks/useOsDocuments";
import { useOutline } from "@/hooks/useOutline";
import { useRevealWindow } from "@/hooks/useRevealWindow";
import { useTabDocuments } from "@/hooks/useTabDocuments";
import { useTabs } from "@/hooks/useTabs";
import { useTheme } from "@/hooks/useTheme";
import { useUpdater } from "@/hooks/useUpdater";
import { writeHtmlFile } from "@/lib/ipc";
import { buildStandaloneHtml } from "@/lib/export/html";
import type { PaletteActions, PaletteState } from "@/lib/palette/items";
import { stepZoom } from "@/lib/zoom";
import documentCss from "@/document.css?inline";
import {
  DOCUMENT_EXTENSIONS,
  TEXT_EXTENSIONS,
  basename,
  cn,
  dirname,
  readOnlyReason,
} from "@/lib/utils";

export default function App() {
  return (
    <ConfigProvider>
      <Shell />
    </ConfigProvider>
  );
}

function Shell() {
  const { config, loaded, update } = useConfig();

  // The window is hidden until the config has loaded and the chrome has painted
  // at the size the last session left behind.
  useRevealWindow(loaded);

  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  /**
   * The scroller of each pane, and which one the keyboard is talking to.
   *
   * There used to be one `scroller` here, because there was one place a
   * document could be. The comparison pane makes that ambiguous — the outline,
   * the find bar and the paging keys all act on "the document", and with two on
   * screen that has to become a choice rather than an assumption. Everything
   * downstream still takes a single element; the only new idea is that it is
   * now *derived* from which pane was last focused.
   */
  const [mainScroller, setMainScroller] = useState<HTMLElement | null>(null);
  const [compareScroller, setCompareScroller] = useState<HTMLElement | null>(null);
  const [focusedPane, setFocusedPane] = useState<"main" | "compare">("main");
  /** A tab is being dragged over the canvas's right half, so the region it
   *  would land in is drawn. */
  const [splitPreview, setSplitPreview] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** The group whose name is being asked for, just after it was created. */
  const [namingGroup, setNamingGroup] = useState<string | null>(null);
  /** The command palette's starting query, or `null` when it is closed — the
   *  same box opens on documents or on commands depending on the chord. */
  const [paletteQuery, setPaletteQuery] = useState<string | null>(null);

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

  const theme = useTheme(config.themeId, config.appearance, config.customThemes, canvas, {
    zoom: config.zoom,
    contentWidth: config.contentWidth,
  });
  const { tree } = useFileTree(folder, config.respectGitignore, config.showHiddenFiles);

  // Gated on `loaded` so the launch check reflects the setting on disk rather
  // than the fallback's `true` — someone who turned this off must not be
  // checked on anyway for the moment before their config arrives.
  const updater = useUpdater(loaded && config.checkForUpdates);

  const tabs = useTabs();
  const { session } = tabs;

  /**
   * The comparison pane's runtime key, which is derived from its path rather
   * than allocated.
   *
   * That is what makes swapping the file in the pane free: a different path is
   * a different key, so it hydrates as a fresh runtime and the collector in
   * `useTabDocuments` drops the old one, with no reset step to remember. The
   * pane is not a tab and deliberately has no id of its own — see
   * `Session.comparePath`.
   */
  const comparePath = session.comparePath;
  const compareId = comparePath === null ? null : `compare:${comparePath}`;

  const docs = useTabDocuments(session, folder, compareId);

  const active = session.activeTabId
    ? session.tabs.find((tab) => tab.id === session.activeTabId)
    : undefined;
  const runtime = active ? docs.runtimes[active.id] : undefined;
  const document = runtime?.document ?? null;

  const compareRuntime = compareId ? docs.runtimes[compareId] : undefined;

  /**
   * The document the outline, the find bar and the paging keys act on.
   *
   * The *toolbar* deliberately keeps describing the active tab whatever has
   * focus: back, forward and "Edit as Markdown" are tab operations, and a
   * breadcrumb that followed focus would offer them for a pane that has none.
   * The pane names its own file in its header instead, so nothing is left to
   * infer from which surface a heading list came from.
   */
  const reading = focusedPane === "compare" ? (compareRuntime?.document ?? null) : document;
  const scroller = focusedPane === "compare" ? compareScroller : mainScroller;

  // The active tab loads on demand rather than at restore time — see
  // `useTabDocuments` for why a ten-tab session must not open ten documents.
  const { hydrate } = docs;
  useEffect(() => {
    if (active) hydrate(active.id, active.path);
  }, [active, hydrate]);

  // The pane loads the same way a tab does, and gets file-watching and live
  // reload with it — which is most of why it is worth having on an AI-written
  // file that is being regenerated while you read the one beside it.
  useEffect(() => {
    if (compareId && comparePath) hydrate(compareId, comparePath);
  }, [compareId, comparePath, hydrate]);

  // Focus cannot stay on a pane that is no longer there, or the outline and the
  // paging keys would go on addressing a document nobody can see.
  useEffect(() => {
    if (comparePath === null) setFocusedPane("main");
  }, [comparePath]);

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

  const outline = useOutline(reading?.toc ?? [], scroller);
  const find = useFind(scroller);

  // Find highlights are ranges into the DOM of one document, so they cannot
  // survive a switch to another tab's DOM — nor a switch to the other pane's,
  // which is the same problem arriving by a different route.
  useEffect(() => {
    find.clear();
    setFindOpen(false);
    // Only when the document under the find bar changes; re-running on every
    // `find` identity would clear the query as the reader types it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.activeTabId, focusedPane, comparePath]);

  const openPaths = useMemo(() => new Set(session.tabs.map((tab) => tab.path)), [session.tabs]);

  const openInTab = useCallback(
    (path: string, permanent: boolean) => {
      if (!folder) setFolder(dirname(path));
      tabs.open(path, { preview: !permanent });
    },
    [folder, tabs],
  );

  // A document handed to us by the OS — a double-clicked `.md`, a second launch
  // routed here by the single-instance plugin, an Apple Event, a file dropped on
  // the window. It always earns a real tab rather than a preview one: the reader
  // asked for this file by name.
  const openFromOs = useCallback(
    (path: string) => {
      setFolder((current) => current ?? dirname(path));
      tabs.open(path);
    },
    [tabs],
  );

  // "Reopen last document" is the tab session coming back, restored in
  // `useTabs`; all that is left here is what the OS handed us, which always wins
  // because the reader asked for that one by name. Gated on `loaded` so it lands
  // on top of the restored session rather than under it.
  useOsDocuments(loaded, openFromOs);

  const dropActive = useFileDrop(
    useCallback(
      (paths: string[]) => {
        paths.forEach(openFromOs);
      },
      [openFromOs],
    ),
  );

  const openFile = useCallback(async () => {
    const path = await openDialog({
      multiple: false,
      // Two filters rather than one, so the default picker still leads with
      // documents while a reader looking for a `.log` can find one.
      filters: [
        { name: "Documents", extensions: DOCUMENT_EXTENSIONS },
        { name: "Text", extensions: TEXT_EXTENSIONS },
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

  /**
   * Picks the file for the comparison pane.
   *
   * An OS dialog rather than a quick-open list, because the pane is most often
   * wanted for a file that is *not* already open — the previous version of a
   * document, something out of Downloads — and reaching those through the
   * folder tree would mean opening a different folder to get at them.
   */
  const openCompare = useCallback(async () => {
    const path = await openDialog({
      multiple: false,
      filters: [
        { name: "Documents", extensions: DOCUMENT_EXTENSIONS },
        { name: "Text", extensions: TEXT_EXTENSIONS },
      ],
    });
    if (typeof path !== "string") return;
    tabs.setCompare(path);
    // The reader just chose this file; the outline and the find bar should be
    // about it without a further click.
    setFocusedPane("compare");
  }, [tabs]);

  const toggleCompare = useCallback(() => {
    if (comparePath !== null) tabs.setCompare(null);
    else void openCompare();
  }, [comparePath, openCompare, tabs]);

  /**
   * Where a dragged tab has to be released to open in the comparison pane: the
   * right half of the canvas, below the chrome.
   *
   * Measured when the drag starts rather than held in state — see `splitZone`
   * on `TabStrip`. The `minY` deliberately sits below the toolbar row and not
   * merely below the tab strip: the strip's own right-hand end is where a tab
   * is dropped to move it *last*, and those two gestures must not overlap.
   */
  const splitZoneOf = useCallback(() => {
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    const chrome = canvas.querySelector<HTMLElement>("[data-canvas-body]");
    const top = chrome?.getBoundingClientRect().top ?? box.top;
    return { minX: box.left + box.width / 2, minY: top };
  }, [canvas]);

  /**
   * A tab dropped in that region opens in the comparison pane — **and stays a
   * tab.**
   *
   * VS Code would *move* the editor, and that is the one part of the gesture
   * not copied. The pane is read-only, so moving a tab into it would quietly
   * take away the ability to edit that file, which is not something a drag
   * should decide. Nothing is lost either way: the pane closes back to exactly
   * the session that was there before it opened.
   */
  const splitToCompare = useCallback(
    (tabId: string) => {
      const tab = session.tabs.find((candidate) => candidate.id === tabId);
      if (!tab) return;
      tabs.setCompare(tab.path);
      setFocusedPane("compare");
    },
    [session.tabs, tabs],
  );

  /**
   * A link followed inside the comparison pane opens in the deck, not in the
   * pane.
   *
   * The pane is a reference held beside your work, so following a link there
   * should not cost you the thing you were comparing against. It also means
   * links land somewhere with history, which the pane deliberately has none of.
   */
  const openFromCompare = useCallback(
    (path: string, fragment: string) => {
      const id = tabs.open(path);
      setFocusedPane("main");
      if (fragment) docs.navigate(id, path, fragment);
    },
    [docs, tabs],
  );

  // Both halves come from the focused pane. They used to be "the active tab"
  // and "the one scroller", which were the same document by construction; with
  // two panes on screen they are not, and taking the title from one while
  // taking the markup from the other would write a file named after a document
  // it does not contain.
  const exportHtml = useCallback(async () => {
    const article = scroller?.querySelector<HTMLElement>(".doc");
    if (!reading || !article) return;

    const path = await saveDialog({
      title: "Export as HTML",
      defaultPath: `${reading.title}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!path) return;

    await writeHtmlFile(
      path,
      buildStandaloneHtml({
        title: reading.title,
        theme,
        article,
        documentCss,
        view: { contentWidth: config.contentWidth },
      }),
    );
  }, [config.contentWidth, reading, scroller, theme]);

  /**
   * Following a link inside a tab.
   *
   * A link to a file that already has its own tab activates that tab rather
   * than opening it twice — one document showing the same bytes in two places
   * helps nobody, and both copies would fight over the same live-reload.
   */
  const followLink = useCallback(
    (tabId: string, path: string, fragment: string) => {
      const elsewhere = session.tabs.find((tab) => tab.path === path && tab.id !== tabId);
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
    (delta: number) => {
      update((current) => ({ zoom: stepZoom(current.zoom, delta) }));
    },
    [update],
  );

  /**
   * Everything the app can be told to do, in one object.
   *
   * Both front-ends read from here — the keyboard below and the command palette
   * — so a command and its chord cannot drift apart, and an action added for
   * one is reachable from the other without being wired twice.
   */
  const actions: PaletteActions = {
    onFind: () => {
      setFindOpen(true);
    },
    // All three are gated on `editable` rather than left to the controls being
    // hidden: a keyboard shortcut reaches past the toolbar, and the source view is
    // a textarea that saves on blur — opening one over a file Rust will refuse to
    // write is how a reader loses an edit they thought they had made. A palette
    // row reaches past it in exactly the same way.
    onToggleSource: () => {
      if (active && document?.editable) toggleSource(active.id);
    },
    onUndo: () => {
      if (active && document?.editable) docs.undoEdit(active.id);
    },
    onRedo: () => {
      if (active && document?.editable) docs.redoEdit(active.id);
    },
    onOpenFile: () => void openFile(),
    onOpenFolder: () => void openFolder(),
    onSettings: () => {
      setSettingsOpen(true);
    },
    onAppearance: () => {
      setAppearanceOpen(true);
    },
    onAbout: () => {
      setAboutOpen(true);
    },
    onToggleRail: () => {
      update({ railCollapsed: !config.railCollapsed });
    },
    onRevealInFolder: () => {
      if (document) void revealItemInDir(document.path).catch(() => undefined);
    },
    onZoomIn: () => {
      zoomBy(0.1);
    },
    onZoomOut: () => {
      zoomBy(-0.1);
    },
    onZoomReset: () => {
      update({ zoom: 1 });
    },
    onPrint: () => {
      window.print();
    },
    onToggleCompare: toggleCompare,
    onExport: () => void exportHtml(),
    onBack: () => {
      step(-1);
    },
    onForward: () => {
      step(1);
    },
    onNewTab: () => void openFile(),
    onCloseTab: () => {
      if (active) tabs.close(active.id);
    },
    onCycleTab: (delta) => {
      tabs.cycle(delta);
    },
    onReopenTab: () => {
      tabs.reopenClosed();
    },
  };

  useKeyboardShortcuts({
    ...actions,
    scroller,
    // The palette owns the whole keyboard while it is open. Without this, Ctrl+F
    // typed into its box would open the find bar behind the modal.
    suspended: paletteQuery !== null,
    onCloseFind: () => {
      setFindOpen(false);
    },
    // The two panels toggle from the keyboard and only ever open from the
    // palette: a row labelled "Settings…" that closes Settings is a row whose
    // label was true a moment ago.
    onSettings: () => {
      setSettingsOpen((open) => !open);
    },
    onAppearance: () => {
      setAppearanceOpen((open) => !open);
    },
    onCommandPalette: () => {
      setPaletteQuery(">");
    },
    onQuickOpen: () => {
      setPaletteQuery("");
    },
    onSelectTab: (index) => {
      tabs.activateIndex(index);
    },
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

  const host = useHostPlatform();
  // Not memoized. It used to be, with a comment claiming the palette's item list
  // depended on its identity — but `docs` is a fresh object literal on every
  // render, so the memo never held and the comment described a property the code
  // did not have. The palette rebuilds its list per render regardless, and
  // deliberately: see the note above `buildItems` in `CommandPalette`.
  const paletteState: PaletteState = {
    hasDocument: document !== null,
    compareOpen: comparePath !== null,
    editable: document?.editable === true,
    sourceMode: active ? sourceTabs.has(active.id) : false,
    canGoBack: active ? docs.canGoBack(active.id) : false,
    canGoForward: active ? docs.canGoForward(active.id) : false,
    railCollapsed: config.railCollapsed,
    mod: host === "macos" ? "⌘" : "Ctrl",
  };

  return (
    <div className="flex h-full">
      <Rail
        collapsed={config.railCollapsed}
        onToggleCollapsed={() => {
          update({ railCollapsed: !config.railCollapsed });
        }}
        folder={folder}
        onPickFolder={() => void openFolder()}
        tree={tree}
        activePath={active?.path ?? null}
        openPaths={openPaths}
        onOpen={openInTab}
        treeCollapsed={config.railTreeCollapsed}
        onToggleTreeCollapsed={() => {
          update({ railTreeCollapsed: !config.railTreeCollapsed });
        }}
        toc={reading?.toc ?? []}
        activeHeadingId={outline.activeId}
        progress={outline.progress}
        onJumpTo={jumpTo}
        onOpenAppearance={() => {
          setAppearanceOpen(true);
        }}
        onOpenSettings={() => {
          setSettingsOpen(true);
        }}
        onExport={() => void exportHtml()}
        onOpenAbout={() => {
          setAboutOpen(true);
        }}
      />

      {/* The canvas: everything inside it is styled by --doc-* tokens, which
          `useTheme` writes onto this element and nowhere else.

          `canvas-edge` is load-bearing rather than decorative: a dark document
          theme can land within a few percent of the rail's own value, and
          without an explicit edge the two planes merge into one surface and the
          whole tool/paper distinction disappears. */}
      <main ref={setCanvas} className="canvas-edge relative flex min-w-0 flex-1 flex-col bg-doc-bg">
        <TitleBar railCollapsed={config.railCollapsed}>
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
            onNewGroup={(id) => {
              setNamingGroup(tabs.group([id]));
            }}
            onAddToGroup={tabs.addToGroup}
            onRenameGroup={setNamingGroup}
            onUngroup={tabs.ungroup}
            onCloseGroup={tabs.closeGroup}
            onRevealInFolder={(id) => {
              const tab = session.tabs.find((candidate) => candidate.id === id);
              if (tab) void revealItemInDir(tab.path).catch(() => undefined);
            }}
            splitZone={splitZoneOf}
            onSplit={splitToCompare}
            onSplitPreview={setSplitPreview}
          />
        </TitleBar>

        {/* One chrome row, split the same way the documents below it are.
            The comparison pane's name and controls belong *here* rather than in
            a header of the pane's own: a header would push that document down
            by its height, and two documents at different offsets cannot be
            compared line for line, which is the only thing the pane is for. */}
        <div className="flex shrink-0">
          <div className="min-w-0 flex-1">
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
              readOnlyReason={document ? readOnlyReason(document) : null}
              sourceMode={active ? sourceTabs.has(active.id) : false}
              onToggleSource={() => {
                if (active) toggleSource(active.id);
              }}
              canGoBack={active ? docs.canGoBack(active.id) : false}
              canGoForward={active ? docs.canGoForward(active.id) : false}
              onBack={() => {
                step(-1);
              }}
              onForward={() => {
                step(1);
              }}
              onFind={() => {
                setFindOpen(true);
              }}
              onAppearance={() => {
                setAppearanceOpen(true);
              }}
              compareOpen={comparePath !== null}
              onToggleCompare={toggleCompare}
            />
          </div>

          {comparePath !== null && (
            <CompareBar
              path={comparePath}
              focused={focusedPane === "compare"}
              onFocus={() => {
                setFocusedPane("compare");
              }}
              onClose={() => {
                tabs.setCompare(null);
              }}
            />
          )}
        </div>

        {findOpen && (
          <FindBar
            find={find}
            onClose={() => {
              find.clear();
              setFindOpen(false);
            }}
          />
        )}

        {/* Two panes, side by side, at a fixed half each. Not resizable yet:
            the pane is here to find out whether comparison earns a permanent
            place in a viewer, and a divider is easy to add afterwards and
            impossible to remove once anyone has dragged it. */}
        {/* `data-canvas-body` is read by `splitZoneOf` to find where the
            documents start, so the drop region is the paper and never the
            chrome above it. */}
        <div data-canvas-body className="relative flex min-h-0 flex-1">
          <div
            className={cn(
              "relative min-w-0 flex-1",
              // Printing renders the DOM, so an open pane would otherwise put
              // both documents in one PDF.
              focusedPane !== "main" && "no-print",
            )}
            onFocusCapture={() => {
              setFocusedPane("main");
            }}
            onPointerDownCapture={() => {
              setFocusedPane("main");
            }}
          >
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
                onScrollerReady={setMainScroller}
                onSave={docs.save}
                sourceTabs={sourceTabs}
                onToggleSource={toggleSource}
              />
            )}
          </div>

          {comparePath !== null && compareId !== null && (
            <ComparePane
              // Keyed by path so a swapped file gets a clean view rather than
              // one carrying the previous document's enhanced nodes.
              key={compareId}
              path={comparePath}
              runtime={compareRuntime}
              theme={theme}
              blockRemoteImages={config.blockRemoteImages}
              focused={focusedPane === "compare"}
              onFocus={() => {
                setFocusedPane("compare");
              }}
              onScrollerReady={setCompareScroller}
              onScrollChange={(scrollTop) => {
                docs.rememberScroll(compareId, scrollTop);
              }}
              onAnchorConsumed={() => {
                docs.clearPendingAnchor(compareId);
              }}
              onOpenDocument={openFromCompare}
            />
          )}

          {/* Where a dragged tab would land. Drawn over the right half rather
              than as a ring around it, because the region is the message: the
              reader is being told the document will occupy exactly this. Ember,
              like every other "this is the target" mark in the chrome. It never
              takes the pointer — the drag owns it through pointer capture, and
              an overlay that could receive events would end the gesture. */}
          {splitPreview && (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 right-0 z-30 w-1/2",
                "bg-ui-ember-wash shadow-[inset_2px_0_0_0_var(--ui-ember)]",
              )}
            />
          )}
        </div>
      </main>

      <TabGroupDialog
        group={
          namingGroup ? (session.groups.find((group) => group.id === namingGroup) ?? null) : null
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

      {/* Mounted only while open, so building its item list — every document in
          the open folder — costs nothing the rest of the time. */}
      {paletteQuery !== null && (
        <CommandPalette
          initialQuery={paletteQuery}
          onClose={() => {
            setPaletteQuery(null);
          }}
          actions={actions}
          state={paletteState}
          tabs={session.tabs}
          activeTabId={session.activeTabId}
          onActivateTab={tabs.activate}
          recentFiles={config.recentFiles}
          openPaths={openPaths}
          onOpenPath={(path) => {
            openInTab(path, true);
          }}
          tree={tree}
          folder={folder}
          // The focused pane's headings, matching what the rail is showing —
          // `@` in the palette and the outline are two routes to one list.
          toc={reading?.toc ?? []}
          onJumpTo={jumpTo}
          customThemes={config.customThemes}
          onPickTheme={(themeId) => {
            update({ themeId });
          }}
        />
      )}

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      <UpdateDialog updater={updater} />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config}
        onUpdateConfig={update}
        onOpenAppearance={() => {
          setAppearanceOpen(true);
        }}
        updater={updater}
      />

      <SettingsDrawer
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
        config={config}
        theme={theme}
        onUpdateConfig={update}
      />

      {/* Outside `<main>` on purpose: the canvas is where `--doc-*` lives, and
          this is chrome. */}
      <DropOverlay active={dropActive} />
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
function useKeyboardShortcuts(
  handlers: PaletteActions & {
    /** Scrolled by the paging keys, so a reader never has to click the document
     *  first — and so we do not have to auto-focus it and paint a focus ring
     *  around every page. */
    scroller: HTMLElement | null;
    /** True while a modal owns the keyboard. Every chord here is registered on
     *  `window`, so nothing else can take one back. */
    suspended: boolean;
    onCloseFind: () => void;
    onCommandPalette: () => void;
    onQuickOpen: () => void;
    onSelectTab: (index: number | "last") => void;
    onMoveTab: (delta: number) => void;
  },
) {
  // The handlers object is rebuilt on every render, so it is held in a ref: the
  // listener is attached once and always calls the current version.
  const current = useRef(handlers);
  current.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const handlers = current.current;
      if (handlers.suspended) return;

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
        case "k":
          event.preventDefault();
          handlers.onQuickOpen();
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
        // Ctrl+Shift+P is the command palette everywhere else, so it is the one
        // people try first; printing keeps the bare chord it has always had.
        case "p":
          event.preventDefault();
          if (event.shiftKey) handlers.onCommandPalette();
          else handlers.onPrint();
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
        // VS Code's split chord, because that is the one people try. It opens
        // the comparison pane here rather than splitting the editor, which is
        // the same gesture aimed at the only thing a second pane is for in a
        // viewer.
        case "\\":
          event.preventDefault();
          handlers.onToggleCompare();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
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
