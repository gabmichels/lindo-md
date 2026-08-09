import { useCallback, useEffect, useState } from "react";

import { useAnnotationRevision } from "@/hooks/useAnnotationRevision";
import { byDocument, type DocumentGroup } from "@/lib/annotate/list";
import { allAnnotations, deleteAnnotation, updateAnnotation, type Annotation } from "@/lib/ipc";

/**
 * Every mark in the store, grouped by document — the panel's data.
 *
 * Read from the database rather than gathered from the open tabs, and that is
 * the entire point of the view: the question is "everything I flagged about X",
 * and the marks that answer it are mostly in files that are not open. Nothing
 * here resolves an anchor, because resolving one needs the document's source;
 * the rows carry their quote for exactly this reason.
 */

export interface AllAnnotations {
  groups: DocumentGroup[];
  /** False until the first load has come back, so an empty panel and a panel
   *  that has not loaded yet are distinguishable. */
  loaded: boolean;
  error: string | null;
  setNote: (annotation: Annotation, body: string) => void;
  remove: (id: number) => void;
}

export function useAllAnnotations(
  /** Whether the panel is open. Closed, this holds nothing and asks for
   *  nothing — the query walks every row the reader has ever written. */
  enabled: boolean,
): AllAnnotations {
  const [groups, setGroups] = useState<DocumentGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { revision, bump } = useAnnotationRevision();

  useEffect(() => {
    if (!enabled) {
      // Dropped rather than kept for the next open. The rows would be however
      // stale the session made them, and showing yesterday's list for the frame
      // before the fetch lands is worse than showing nothing for it.
      setGroups([]);
      setLoaded(false);
      return;
    }

    const live = { current: true };
    void allAnnotations()
      .then((rows) => {
        if (!live.current) return;
        setGroups(byDocument(rows));
        setLoaded(true);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (live.current) setError(message(cause));
      });

    return () => {
      live.current = false;
    };
    // `revision` is what makes a highlight made on the page appear over here.
  }, [enabled, revision]);

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

  return { groups, loaded, error, setNote, remove };
}

/** `LindoError` serializes to a plain string, so an error from Rust is already
 *  written for a reader; anything else is a bug here and says so. */
function message(cause: unknown): string {
  if (typeof cause === "string") return cause;
  return cause instanceof Error ? cause.message : "Something went wrong with your annotations.";
}
