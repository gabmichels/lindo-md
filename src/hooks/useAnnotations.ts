import { useCallback, useEffect, useRef, useState } from "react";

import { createAnchor, overlaps, resolveAnchor } from "@/lib/annotate/anchor";
import {
  applyHighlights,
  clearHighlights,
  paintRanges,
  supportsHighlights,
  type PaintableMark,
} from "@/lib/annotate/paint";
import type { SourceRange } from "@/lib/edit/selection";
import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
  reanchorAnnotations,
  type Annotation,
  type Document,
  type Reanchor,
} from "@/lib/ipc";

/**
 * One document's highlights: loaded, re-anchored against the file as it is now,
 * and painted.
 *
 * The order matters and is not arbitrary. Marks are resolved *before* they are
 * painted, and the results of that resolution are written back in one batch,
 * because otherwise every load of an edited document searches for every mark
 * again — the search is the expensive path and it is supposed to run once.
 */

/** An annotation plus where it actually is now, or null if it could not be
 *  found. An orphan stays in the list: it is the reader's note, and dropping it
 *  because a sentence was reworded would be losing data to a rewording. */
export interface ResolvedAnnotation extends Annotation {
  range: SourceRange | null;
}

export interface AnnotationState {
  marks: ResolvedAnnotation[];
  /** Marks a highlight over the reader's current selection. */
  highlight: (range: SourceRange, color: string) => void;
  /** Removes every mark overlapping `range` — how a highlight is taken off, since
   *  a mark has no handle of its own to click yet. */
  removeAt: (range: SourceRange) => void;
  /** False where the browser cannot paint ranges. Nothing is stored differently;
   *  the marks simply do not show, so the UI hides the affordance rather than
   *  offering one whose result is invisible. */
  supported: boolean;
}

export function useAnnotations(doc: Document | null, article: HTMLElement | null): AnnotationState {
  const [marks, setMarks] = useState<ResolvedAnnotation[]>([]);
  const supported = useRef(supportsHighlights());

  // Only where `data-sourcepos` is trustworthy. `files.rs` builds no block map
  // for plain text or MDX, so there is nothing to anchor against — the same
  // boundary that makes those two read-only.
  const path = doc && doc.blocks.length > 0 ? doc.path : null;
  const source = doc?.source ?? "";
  const contentHash = doc?.contentHash ?? "";

  // Re-runs on every save, because `contentHash` changes with the file: an edit
  // above a mark moves it, and the offsets have to be re-found before the next
  // paint or the highlight sits on the wrong words.
  useEffect(() => {
    if (!path) {
      setMarks([]);
      return;
    }

    // A holder rather than a bare `let`: the only assignment is in the cleanup
    // closure, which is created after the one that reads it, so type-aware lint
    // narrows a plain boolean to `false` and calls the guard dead.
    const live = { current: true };
    void (async () => {
      const stored = await listAnnotations(path);
      if (!live.current) return;

      const resolved: ResolvedAnnotation[] = [];
      const moved: Reanchor[] = [];
      for (const annotation of stored) {
        const outcome = resolveAnchor(source, contentHash, annotation);
        if (outcome.status === "orphaned") {
          resolved.push({ ...annotation, range: null });
          continue;
        }
        resolved.push({ ...annotation, range: outcome.range });
        if (outcome.status === "moved") {
          moved.push({
            id: annotation.id,
            startOffset: outcome.range.start,
            endOffset: outcome.range.end,
            anchoredHash: contentHash,
          });
        }
      }

      setMarks(resolved);
      // Fire and forget: the marks are already correct on screen, and a failure
      // to persist costs a search next time rather than anything visible.
      if (moved.length > 0) void reanchorAnnotations(moved);
    })();

    return () => {
      live.current = false;
    };
  }, [path, source, contentHash]);

  // Paint after every render of the document, not only when the marks change:
  // `mirror` replaces the blocks an edit touched, and a Range holds the *node*
  // it was built over. A replaced node leaves its range pointing at something no
  // longer in the tree, which paints nothing and reports no error.
  useEffect(() => {
    if (!article || !supported.current) return;

    const paintable: PaintableMark[] = marks.flatMap((mark) =>
      mark.range ? [{ range: mark.range, color: mark.color }] : [],
    );
    applyHighlights(paintRanges(article, doc?.blocks ?? [], paintable));
  }, [article, marks, doc?.blocks, doc?.html]);

  // Highlights are global to the page, so a document that goes away has to take
  // its own off — otherwise switching tabs leaves the previous document's marks
  // registered against nodes that are no longer on screen.
  useEffect(() => clearHighlights, [path]);

  const highlight = useCallback(
    (range: SourceRange, color: string) => {
      if (!path) return;
      const anchor = createAnchor(source, range, contentHash);
      if (!anchor) return;

      void createAnnotation({ path, color, body: "", ...anchor }).then((made) => {
        setMarks((current) => [
          ...current,
          { ...made, range: { start: anchor.startOffset, end: anchor.endOffset } },
        ]);
      });
    },
    [path, source, contentHash],
  );

  const removeAt = useCallback((range: SourceRange) => {
    setMarks((current) => {
      const [gone, kept] = partition(current, (mark) => overlaps(mark.range, range));
      for (const mark of gone) void deleteAnnotation(mark.id);
      return gone.length > 0 ? kept : current;
    });
  }, []);

  return { marks, highlight, removeAt, supported: supported.current };
}

function partition<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) (predicate(item) ? yes : no).push(item);
  return [yes, no];
}
