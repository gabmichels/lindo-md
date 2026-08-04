import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";

import { AboutDialog } from "@/components/AboutDialog";
import { DocumentView } from "@/components/DocumentView";
import { EmptyState } from "@/components/EmptyState";
import { FindBar } from "@/components/FindBar";
import { Rail } from "@/components/Rail";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { TitleBar } from "@/components/TitleBar";
import { ConfigProvider, useConfig } from "@/hooks/useConfig";
import { useDocument } from "@/hooks/useDocument";
import { useFileTree } from "@/hooks/useFileTree";
import { useFind } from "@/hooks/useFind";
import { useHostPlatform } from "@/hooks/useHostPlatform";
import { useOutline } from "@/hooks/useOutline";
import { useTheme } from "@/hooks/useTheme";
import { writeHtmlFile } from "@/lib/ipc";
import { buildStandaloneHtml } from "@/lib/export/html";
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
  );
  const { tree } = useFileTree(folder, config.respectGitignore);
  const doc = useDocument(folder);
  const outline = useOutline(doc.document?.toc ?? [], scroller);
  const find = useFind(scroller);

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

  useKeyboardShortcuts({
    onFind: () => setFindOpen(true),
    onCloseFind: () => setFindOpen(false),
    onOpenFile: () => void openFile(),
    onOpenFolder: () => void openFolder(),
    onSettings: () => setSettingsOpen((open) => !open),
    onPrint: () => window.print(),
    onExport: () => void exportHtml(),
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
        onOpenSettings={() => setSettingsOpen(true)}
        onExport={() => void exportHtml()}
        onOpenAbout={() => setAboutOpen(true)}
        insetTop={host === "macos"}
      />

      {/* The canvas: everything inside it is styled by --doc-* tokens, which
          `useTheme` writes onto this element and nowhere else. */}
      <main ref={setCanvas} className="relative flex min-w-0 flex-1 flex-col bg-doc-bg">
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
          onSettings={() => setSettingsOpen(true)}
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

      <SettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
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
  onFind: () => void;
  onCloseFind: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSettings: () => void;
  onPrint: () => void;
  onExport: () => void;
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
      if (!(event.ctrlKey || event.metaKey)) return;

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
        case ",":
          event.preventDefault();
          handlers.onSettings();
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
