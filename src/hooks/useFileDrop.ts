import { useEffect, useRef, useState } from "react";

import { onFileDrag } from "@/lib/ipc";
import { isMarkdownPath } from "@/lib/utils";

/**
 * Markdown files dragged onto the window from outside the app.
 *
 * Returns whether a drop would land right now, so the window can say so. That
 * feedback is the whole reason this is a hook and not a one-line listener: a
 * drag this app will refuse looks exactly like a drag it will accept, and the
 * reader only finds out by letting go. A drag carrying no Markdown never lights
 * up, and dropping it does nothing.
 */
export function useFileDrop(onDrop: (paths: string[]) => void): boolean {
  const [receptive, setReceptive] = useState(false);

  // Subscribe once and read the callback through a ref — see `useOsDocuments`
  // for why re-subscribing on every identity change is a dropped-event bug.
  const handler = useRef(onDrop);
  useEffect(() => {
    handler.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    const unlisten = onFileDrag((event) => {
      if (event.phase === "leave") {
        setReceptive(false);
        return;
      }

      // Filtered here rather than in Rust because it decides what the overlay
      // says, and asking Rust would put an await between the drag arriving and
      // the window reacting to it.
      const paths = event.paths.filter(isMarkdownPath);

      if (event.phase === "over") {
        setReceptive(paths.length > 0);
        return;
      }

      setReceptive(false);
      if (paths.length > 0) handler.current(paths);
    });

    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  return receptive;
}
