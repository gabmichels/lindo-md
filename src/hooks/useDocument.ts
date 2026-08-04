import { useCallback, useEffect, useRef, useState } from "react";

import {
  onDocumentChanged,
  openDocument,
  watchPaths,
  type Document,
} from "@/lib/ipc";

/**
 * Owns the open document, the navigation history between documents, and the
 * live reload that follows edits made outside the app.
 *
 * History is kept here rather than in a router because the app has exactly one
 * kind of navigation — "open this file, maybe at this anchor" — and a router
 * would add a URL layer that nothing else in the app uses.
 */

export interface DocumentState {
  document: Document | null;
  loading: boolean;
  error: string | null;
  /** Anchor to scroll to once the document has rendered, if the link had one. */
  pendingAnchor: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  open: (path: string, anchor?: string) => void;
  /** Opens a document the reader did not just ask for — the one they had open
   *  last session. A file that has since been deleted or moved leaves the empty
   *  state rather than greeting them with an error they did not cause. */
  restore: (path: string) => void;
  back: () => void;
  forward: () => void;
  clearPendingAnchor: () => void;
}

export function useDocument(folder: string | null): DocumentState {
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  /** Guards against a slow open finishing after a newer one and winning. */
  const generation = useRef(0);

  const load = useCallback(
    (path: string, anchor: string | null, quiet = false) => {
      const token = ++generation.current;
      setLoading(true);

      openDocument(path)
        .then((next) => {
          if (generation.current !== token) return;
          setDocument(next);
          setPendingAnchor(anchor);
          setError(null);
        })
        .catch((e: unknown) => {
          if (generation.current !== token || quiet) return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (generation.current === token) setLoading(false);
        });
    },
    [],
  );

  const open = useCallback(
    (path: string, anchor?: string) => {
      // Opening from a link truncates any forward history, the way a browser
      // does — the branch the reader did not take is gone.
      history.current = history.current.slice(0, cursor.current + 1);
      history.current.push(path);
      cursor.current = history.current.length - 1;
      load(path, anchor ?? null);
    },
    [load],
  );

  const restore = useCallback(
    (path: string) => {
      history.current = [path];
      cursor.current = 0;
      load(path, null, true);
    },
    [load],
  );

  const back = useCallback(() => {
    if (cursor.current <= 0) return;
    cursor.current -= 1;
    load(history.current[cursor.current]!, null);
  }, [load]);

  const forward = useCallback(() => {
    if (cursor.current >= history.current.length - 1) return;
    cursor.current += 1;
    load(history.current[cursor.current]!, null);
  }, [load]);

  // Re-watch whenever the document or the folder changes. Rust replaces the
  // whole watch set, so one call covers both.
  useEffect(() => {
    void watchPaths(document?.path ?? null, folder).catch(() => undefined);
  }, [document?.path, folder]);

  // Live reload. Re-reads without touching history: the reader is still on the
  // same document, it just changed underneath them.
  useEffect(() => {
    const path = document?.path;
    if (!path) return;

    const unlisten = onDocumentChanged((changed) => {
      if (changed === path) load(path, null);
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [document?.path, load]);

  return {
    document,
    loading,
    error,
    pendingAnchor,
    canGoBack: cursor.current > 0,
    canGoForward: cursor.current < history.current.length - 1,
    open,
    restore,
    back,
    forward,
    clearPendingAnchor: useCallback(() => setPendingAnchor(null), []),
  };
}
