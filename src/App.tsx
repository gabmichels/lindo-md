import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";

import { AboutDialog } from "@/components/AboutDialog";
import { DocumentView } from "@/components/DocumentView";
import { EmptyState } from "@/components/EmptyState";
import { FindBar } from "@/components/FindBar";
import { Rail } from "@/components/Rail";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { TitleBar } from "@/components/TitleBar";
import { ConfigProvider, useConfig } from "@/hooks/useConfig";
import { useDocument } from "@/hooks/useDocument";
import { useFileTree } from "@/hooks/useFileTree";
import { useFind } from "@/hooks/useFind";
import { useHostPlatform } from "@/hooks/useHostPlatform";
import { useOutline } from "@/hooks/useOutline";
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
  const host = useHostPlatform();

  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    if (loaded && config.lastFolder) setFolder(config.lastFolder);
  }, [loaded, config.lastFolder]);

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
  const doc = useDocument(folder);
  const outline = useOutline(doc.document?.toc ?? [], scroller);
  const find = useFind(scroller);

  // A document handed to us by the OS — a double-clicked `.md`, or a second
  // launch routed here by the single-instance plugin. Opening it also points the
  // rail at its folder, so the reader lands somewhere navigable.
  const openFromOs = useCallback(
    (path: string) => {
      setFolder((current) => current ?? dirname(path));
      doc.open(path);
    },
    [doc],
  );

  // What to show on launch. Deliberately waits for settings to load: whether to
  // fall back to the last document is one of them, and running before they
  // arrive would decide it from the fallback defaults instead.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (!loaded || openedInitial.current) return;
    openedInitial.current = true;

    const lastDocument = config.reopenLastDocument
      ? config.recentFiles[0]
      : undefined;

    getInitialDocument().then(
      (path) => {
        // A double-clicked file always wins: the reader asked for that one.
        if (path) openFromOs(path);
        else if (lastDocument) {
          setFolder((current) => current ?? dirname(lastDocument));
          doc.restore(lastDocument);
        }
      },
      () => undefined,
    );
    // The config values and `doc` are read once, at the moment this fires — the
    // ref above is what makes this a single decision rather than something that
    // re-runs when the reader later changes the setting.
  }, [loaded, openFromOs, config.reopenLastDocument, config.recentFiles, doc]);

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
    doc.open(path);
  }, [doc, folder]);

  const openFolder = useCallback(async () => {
    const path = await openDialog({ directory: true, multiple: false });
    if (typeof path !== "string") return;
    setFolder(path);
    update({ lastFolder: path });
  }, [update]);

  const exportHtml = useCallback(async () => {
    const article = scroller?.querySelector<HTMLElement>(".doc");
    if (!doc.document || !article) return;

    const path = await saveDialog({
      title: "Export as HTML",
      defaultPath: `${doc.document.title}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!path) return;

    await writeHtmlFile(
      path,
      buildStandaloneHtml({
        title: doc.document.title,
        theme,
        article,
        documentCss,
      }),
    );
  }, [doc.document, scroller, theme]);

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
    onOpenFile: () => void openFile(),
    onOpenFolder: () => void openFolder(),
    onSettings: () => setSettingsOpen((open) => !open),
    onAppearance: () => setAppearanceOpen((open) => !open),
    onPrint: () => window.print(),
    onExport: () => void exportHtml(),
    onZoomIn: () => zoomBy(0.1),
    onZoomOut: () => zoomBy(-0.1),
    onZoomReset: () => update({ zoom: 1 }),
    onBack: doc.back,
    onForward: doc.forward,
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
        activePath={doc.document?.path ?? null}
        onOpen={(path) => doc.open(path)}
        toc={doc.document?.toc ?? []}
        activeHeadingId={outline.activeId}
        progress={outline.progress}
        onJumpTo={jumpTo}
        onOpenAppearance={() => setAppearanceOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onExport={() => void exportHtml()}
        onOpenAbout={() => setAboutOpen(true)}
        insetTop={host === "macos"}
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
        <TitleBar
          breadcrumb={
            doc.document
              ? {
                  folder: folder ? basename(folder) : null,
                  name: doc.document.name,
                }
              : null
          }
          path={doc.document?.path ?? null}
          canGoBack={doc.canGoBack}
          canGoForward={doc.canGoForward}
          onBack={doc.back}
          onForward={doc.forward}
          onFind={() => setFindOpen(true)}
          onAppearance={() => setAppearanceOpen(true)}
        />

        {findOpen && <FindBar find={find} onClose={() => { find.clear(); setFindOpen(false); }} />}

        <div className="min-h-0 flex-1">
          {doc.error ? (
            <Message text={doc.error} />
          ) : doc.document ? (
            <DocumentView
              document={doc.document}
              theme={theme}
              blockRemoteImages={config.blockRemoteImages}
              pendingAnchor={doc.pendingAnchor}
              onAnchorConsumed={doc.clearPendingAnchor}
              onOpenDocument={(path, fragment) => doc.open(path, fragment)}
              onScrollerReady={setScroller}
            />
          ) : (
            <EmptyState
              recentFiles={config.recentFiles}
              onOpenFile={() => void openFile()}
              onOpenFolder={() => void openFolder()}
              onOpenRecent={(path) => doc.open(path)}
            />
          )}
        </div>
      </main>

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

      switch (event.key.toLowerCase()) {
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
        case "e":
          event.preventDefault();
          handlers.onExport();
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
