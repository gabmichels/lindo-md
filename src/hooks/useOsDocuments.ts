import { useEffect, useRef } from "react";

import { getPendingDocuments, onOpenDocumentRequested } from "@/lib/ipc";

/**
 * Documents the OS hands us: a double-clicked `.md`, an "Open with", a launch
 * argument.
 *
 * Two sources, because the hand-off and this hook mounting race in both
 * directions — a cold launch delivers before React exists, a double-click into
 * a running window delivers long after. `getPendingDocuments` drains whatever
 * arrived before we were listening; the event carries everything after. Rust
 * feeds both from one queue (`assoc::OpenQueue`), and a path arriving twice is
 * harmless: a file is never open in two tabs.
 *
 * `ready` gates only the drain: the tab session is restored from the config, and
 * opening on top of that restore is the only order that keeps both the saved
 * tabs and this one.
 */
export function useOsDocuments(ready: boolean, onOpen: (path: string) => void): void {
  // The subscription is made once and reads the callback through a ref, rather
  // than re-subscribing whenever `onOpen` changes identity. `listen` is async,
  // so every re-subscribe leaves a gap with no listener attached — and a
  // document double-clicked during that gap is one the reader watches vanish.
  const handler = useRef(onOpen);
  useEffect(() => {
    handler.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const unlisten = onOpenDocumentRequested((path) => {
      handler.current(path);
    });
    return () => {
      void unlisten.then((off) => {
        off();
      });
    };
  }, []);

  const drained = useRef(false);
  useEffect(() => {
    if (!ready || drained.current) return;
    drained.current = true;

    void getPendingDocuments().then(
      (paths) => {
        paths.forEach((path) => {
          handler.current(path);
        });
      },
      () => undefined,
    );
  }, [ready]);
}
