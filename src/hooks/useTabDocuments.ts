import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  onDocumentChanged,
  openDocument,
  saveDocument,
  watchPaths,
  type Document,
} from "@/lib/ipc";
import type { Session } from "@/lib/tabs/model";

/**
 * The document behind each tab: its content, its own navigation history, and
 * where it was scrolled to.
 *
 * This is `useDocument` from the single-document days, keyed by tab id. Two
 * things are deliberately different:
 *
 * - **Tabs hydrate lazily.** A restored session opens one file, not ten. That
 *   keeps startup quick, and it matters more than it looks: `open_document`
 *   rewrites `config.json` to record the recent, so eagerly restoring a large
 *   session would mean a burst of file writes before the window is even up.
 * - **`canGoBack`/`canGoForward` are state, not refs.** They used to be read
 *   off a ref and happened to look right because an unrelated state update
 *   always rode along; with tabs that coincidence no longer holds.
 */

export interface TabRuntime {
  document: Document | null;
  loading: boolean;
  error: string | null;
  /** Anchor to scroll to once the document has rendered, if the link had one. */
  pendingAnchor: string | null;
  history: string[];
  cursor: number;
  scrollTop: number;
  /**
   * Sources this document had before each edit, newest last, and the ones undone
   * back off it.
   *
   * The rendered view cancels every `beforeinput`, which means the browser's own
   * undo stack never sees an edit and `Ctrl+Z` would otherwise do nothing at all
   * — on a feature whose whole job is changing files. Snapshots rather than
   * inverse operations: a document is a string, and a handful of copies of one
   * costs less than the bookkeeping to undo an edit precisely.
   */
  undo: string[];
  redo: string[];
}

const BLANK: TabRuntime = {
  document: null,
  loading: false,
  error: null,
  pendingAnchor: null,
  history: [],
  cursor: 0,
  scrollTop: 0,
  undo: [],
  redo: [],
};

/** Enough to cover a mistake and the few edits after it, without holding a copy
 *  of every state a long editing session passed through. */
const UNDO_DEPTH = 50;

export interface TabDocuments {
  runtimes: Record<string, TabRuntime>;
  /** Loads a tab's document if it has not been loaded yet. Safe to call on
   *  every render — a hydrated, loading or failed tab is left alone. */
  hydrate: (id: string, path: string) => void;
  /** Follows a link inside a tab, which is what builds that tab's history. */
  navigate: (id: string, path: string, anchor?: string) => void;
  back: (id: string) => void;
  forward: (id: string) => void;
  canGoBack: (id: string) => boolean;
  canGoForward: (id: string) => boolean;
  rememberScroll: (id: string, scrollTop: number) => void;
  clearPendingAnchor: (id: string) => void;
  /** Writes edited Markdown for a tab's document. Resolves false if the write
   *  was refused, so the caller can take its optimistic change back. */
  save: (id: string, source: string) => Promise<boolean>;
  undoEdit: (id: string) => void;
  redoEdit: (id: string) => void;
  canUndo: (id: string) => boolean;
  canRedo: (id: string) => boolean;
}

/**
 * @param pinnedId A runtime that is live without being a tab — the comparison
 *   pane's document. It is kept out of `session.tabs` on purpose (the pane is a
 *   path, not a tab; see `Session.comparePath`), so without naming it here the
 *   collector below would drop it on the next tab change and the watcher would
 *   never see the file it holds.
 */
export function useTabDocuments(
  session: Session,
  folder: string | null,
  pinnedId: string | null = null,
): TabDocuments {
  const [runtimes, setRuntimes] = useState<Record<string, TabRuntime>>({});

  const current = useRef(runtimes);
  current.current = runtimes;

  /** Guards against a slow open finishing after a newer one, per tab. */
  const generation = useRef<Record<string, number>>({});

  /** The content fingerprint of the last save that landed, per path. Updated
   *  synchronously, unlike the copy inside `Document`, which waits for a render. */
  const written = useRef<Record<string, string>>({});

  const patch = useCallback((id: string, next: Partial<TabRuntime>) => {
    setRuntimes((runtimes) => ({
      ...runtimes,
      [id]: { ...(runtimes[id] ?? BLANK), ...next },
    }));
  }, []);

  const load = useCallback(
    (id: string, path: string, anchor: string | null) => {
      const token = (generation.current[id] ?? 0) + 1;
      generation.current[id] = token;
      patch(id, { loading: true });

      openDocument(path).then(
        (document) => {
          if (generation.current[id] !== token) return;
          patch(id, {
            document,
            pendingAnchor: anchor,
            error: null,
            loading: false,
          });
        },
        (error: unknown) => {
          if (generation.current[id] !== token) return;
          patch(id, {
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          });
        },
      );
    },
    [patch],
  );

  const hydrate = useCallback(
    (id: string, path: string) => {
      const runtime = current.current[id];
      // A tab that failed is left failed: retrying on every render would spin
      // on a deleted file instead of showing the reader what went wrong.
      if (runtime && (runtime.document || runtime.loading || runtime.error)) return;
      patch(id, { history: [path], cursor: 0 });
      load(id, path, null);
    },
    [load, patch],
  );

  const navigate = useCallback(
    (id: string, path: string, anchor?: string) => {
      const runtime = current.current[id] ?? BLANK;
      // Opening from a link truncates any forward history, the way a browser
      // does — the branch the reader did not take is gone.
      const history = [...runtime.history.slice(0, runtime.cursor + 1), path];
      patch(id, { history, cursor: history.length - 1 });
      load(id, path, anchor ?? null);
    },
    [load, patch],
  );

  const step = useCallback(
    (id: string, delta: number) => {
      const runtime = current.current[id];
      if (!runtime) return;
      const cursor = runtime.cursor + delta;
      const path = runtime.history[cursor];
      if (!path) return;
      patch(id, { cursor });
      load(id, path, null);
    },
    [load, patch],
  );

  /** `track` is how an edit is remembered for undo. An undo or a redo passes
   *  "no", because moving through the stack must not push onto it. */
  const write = useCallback(
    async (
      id: string,
      source: string,
      track: "push" | "undo" | "redo" | "none",
    ): Promise<boolean> => {
      const runtime = current.current[id];
      const document = runtime?.document;
      if (!document) return false;
      if (source === document.source) return true;

      const before = document.source;

      try {
        // The fingerprint of the last save that actually landed, which is not
        // necessarily the one in `document`: a save resolves before React has
        // re-rendered with its result, so a second edit arriving in between
        // would otherwise carry the fingerprint of a file that no longer exists
        // and be refused as somebody else's work.
        const saved = await saveDocument(
          document.path,
          source,
          written.current[document.path] ?? document.contentHash,
        );
        written.current[saved.path] = saved.contentHash;

        const stacks = (existing: TabRuntime): Pick<TabRuntime, "undo" | "redo"> => {
          switch (track) {
            case "push":
              // A fresh edit makes the redo branch unreachable, the way a browser
              // drops forward history when you follow a new link.
              return {
                undo: [...existing.undo, before].slice(-UNDO_DEPTH),
                redo: [],
              };
            case "undo":
              return {
                undo: existing.undo.slice(0, -1),
                redo: [...existing.redo, before].slice(-UNDO_DEPTH),
              };
            case "redo":
              return {
                undo: [...existing.undo, before].slice(-UNDO_DEPTH),
                redo: existing.redo.slice(0, -1),
              };
            case "none":
              return { undo: existing.undo, redo: existing.redo };
          }
        };
        // Every tab showing this file, not just the one that was edited. The
        // same document can be open more than once, and the watcher has been
        // told to ignore this write, so nothing else will update the others.
        setRuntimes((runtimes) =>
          Object.fromEntries(
            Object.entries(runtimes).map(([key, runtime]) => {
              if (runtime.document?.path !== saved.path) return [key, runtime];
              // Only the tab the edit was made in owns the undo history for it;
              // another tab on the same file gets the new content, not the
              // stack, or undoing in one would rewind the other.
              const next = { ...runtime, document: saved, error: null };
              return [key, key === id ? { ...next, ...stacks(runtime) } : next];
            }),
          ),
        );
        return true;
      } catch (error: unknown) {
        // A refused write is the interesting case: the file changed underneath
        // the reader, and they need to know rather than wonder why nothing
        // happened.
        patch(id, {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    [patch],
  );

  const save = useCallback((id: string, source: string) => write(id, source, "push"), [write]);

  /** Moves one step along the edit history. Named apart from `step`, which walks
   *  the *navigation* history — two different back buttons in one hook. */
  const rewind = useCallback(
    (id: string, direction: "undo" | "redo") => {
      const runtime = current.current[id];
      if (!runtime) return;
      const stack = direction === "undo" ? runtime.undo : runtime.redo;
      const target = stack[stack.length - 1];
      if (target === undefined) return;
      void write(id, target, direction);
    },
    [write],
  );

  // Forget the runtime of a tab that has been closed, or a long session would
  // hold every document it ever showed.
  useEffect(() => {
    const live = new Set(session.tabs.map((tab) => tab.id));
    if (pinnedId) live.add(pinnedId);
    setRuntimes((runtimes) => {
      const keys = Object.keys(runtimes);
      if (keys.every((key) => live.has(key))) return runtimes;
      return Object.fromEntries(Object.entries(runtimes).filter(([key]) => live.has(key)));
    });
  }, [session.tabs, pinnedId]);

  // Every hydrated tab is watched, not just the visible one, so a file edited
  // outside the app reloads in the background too — and the comparison pane
  // with them, which is what makes it useful for watching a file an agent is
  // rewriting. Joined into a string because the array is rebuilt on every
  // render and would re-run the effect forever.
  const watchKey = useMemo(
    () =>
      [...session.tabs.map((tab) => tab.id), ...(pinnedId ? [pinnedId] : [])]
        .map((id) => runtimes[id]?.document?.path)
        .filter((path): path is string => Boolean(path))
        .join(" "),
    [session.tabs, runtimes, pinnedId],
  );

  useEffect(() => {
    const documents = watchKey ? watchKey.split(" ") : [];
    void watchPaths(documents, folder).catch(() => undefined);
  }, [watchKey, folder]);

  // Live reload. Re-reads without touching history: the reader is still on the
  // same document, it just changed underneath them.
  useEffect(() => {
    const unlisten = onDocumentChanged((changed) => {
      for (const [id, runtime] of Object.entries(current.current)) {
        if (runtime.document?.path === changed) load(id, changed, null);
      }
    });
    return () => {
      void unlisten.then((off) => {
        off();
      });
    };
  }, [load]);

  return {
    runtimes,
    hydrate,
    navigate,
    save,
    undoEdit: useCallback(
      (id) => {
        rewind(id, "undo");
      },
      [rewind],
    ),
    redoEdit: useCallback(
      (id) => {
        rewind(id, "redo");
      },
      [rewind],
    ),
    canUndo: useCallback((id) => (runtimes[id]?.undo.length ?? 0) > 0, [runtimes]),
    canRedo: useCallback((id) => (runtimes[id]?.redo.length ?? 0) > 0, [runtimes]),
    back: useCallback(
      (id) => {
        step(id, -1);
      },
      [step],
    ),
    forward: useCallback(
      (id) => {
        step(id, 1);
      },
      [step],
    ),
    canGoBack: useCallback((id) => (runtimes[id]?.cursor ?? 0) > 0, [runtimes]),
    canGoForward: useCallback(
      (id) => {
        const runtime = runtimes[id];
        return runtime ? runtime.cursor < runtime.history.length - 1 : false;
      },
      [runtimes],
    ),
    rememberScroll: useCallback(
      (id, scrollTop) => {
        const runtime = current.current[id];
        if (!runtime || runtime.scrollTop === scrollTop) return;
        // Written straight to the ref as well, because a tab switch reads it
        // back in the same tick that it is captured.
        current.current = {
          ...current.current,
          [id]: { ...runtime, scrollTop },
        };
        patch(id, { scrollTop });
      },
      [patch],
    ),
    clearPendingAnchor: useCallback(
      (id) => {
        patch(id, { pendingAnchor: null });
      },
      [patch],
    ),
  };
}
