import { useCallback, useEffect, useState } from "react";

import { useAnnotationRevision } from "@/hooks/useAnnotationRevision";
import { deleteAnnotation, listAnnotations, updateAnnotation, type Annotation } from "@/lib/ipc";

/**
 * The marks on the document being read — the panel's data.
 *
 * Read from the database rather than gathered from the rendered page, because a
 * mark whose words have gone still has a row: it is in the store, it has a quote
 * and a note, and the page it used to point into can say nothing about it.
 * Nothing here resolves an anchor; the rows carry their quote for exactly this
 * reason.
 *
 * **Asked for by path, one document at a time.** Not the whole store filtered
 * over here, which is what this did first and is a mistake worth recording: a
 * document is keyed in the database by its *canonical* path — `\\?\C:\notes\a.md`
 * on Windows — and what the frontend holds is the path the file was opened by.
 * The two are the same file and different strings, so every comparison made here
 * would be false and the panel would sit empty beside a document full of marks.
 * `list_annotations` canonicalizes the path it is given, so asking the store the
 * question is both simpler and the only way to get a true answer.
 *
 * Rust returns them in `start_offset` order, which is stored position rather
 * than current position — an honest order to offer, since resolving an anchor
 * needs the source and a mark that has since moved is only listed a little out
 * of place.
 */

export interface DocumentNotes {
  /** This document's marks. Empty with no document open, which is exactly what
   *  the panel should show then. */
  annotations: readonly Annotation[];
  /** False until the first load has come back, so an empty panel and a panel
   *  that has not loaded yet are distinguishable. */
  loaded: boolean;
  error: string | null;
  setNote: (annotation: Annotation, body: string) => void;
  remove: (id: number) => void;
}

export function useDocumentNotes(
  /** Whether the panel is open. Closed, this holds nothing and asks for
   *  nothing. */
  enabled: boolean,
  /** The document on screen. Null with no tab open, which empties the list
   *  rather than leaving the last document's marks beside a blank page. */
  path: string | null,
): DocumentNotes {
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { revision, bump } = useAnnotationRevision();

  useEffect(() => {
    if (!enabled || path === null) {
      // Dropped rather than kept for the next open. The rows would belong to
      // whatever was last read, and showing the wrong document's notes for the
      // frame before the fetch lands is worse than showing none for it.
      setAnnotations([]);
      setLoaded(false);
      return;
    }

    const live = { current: true };
    void listAnnotations(path)
      .then((rows) => {
        if (!live.current) return;
        setAnnotations(rows);
        setLoaded(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (live.current) setError(message(cause));
      });

    return () => {
      // Switching tabs quickly can leave two loads in flight; this is what keeps
      // the slower one from painting its document's marks over the newer one's.
      live.current = false;
    };
    // `revision` is what makes a highlight made on the page appear over here.
  }, [enabled, path, revision]);

  const setNote = useCallback(
    (annotation: Annotation, body: string) => {
      if (annotation.body === body) return;
      void updateAnnotation(annotation.id, annotation.color, body)
        .then(() => {
          setError(null);
          bump();
        })
        .catch((cause: unknown) => {
          setError(message(cause));
        });
    },
    [bump],
  );

  const remove = useCallback(
    (id: number) => {
      void deleteAnnotation(id)
        .then(() => {
          setError(null);
          bump();
        })
        .catch((cause: unknown) => {
          setError(message(cause));
        });
    },
    [bump],
  );

  return { annotations, loaded, error, setNote, remove };
}

/** `LindoError` serializes to a plain string, so an error from Rust is already
 *  written for a reader; anything else is a bug here and says so. */
function message(cause: unknown): string {
  if (typeof cause === "string") return cause;
  return cause instanceof Error ? cause.message : "Something went wrong with your annotations.";
}
