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
  relinkAnnotations,
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
  /**
   * What went wrong with the last annotation operation, or null.
   *
   * Present because every call into the store can fail for reasons the reader
   * can act on — a second copy of the app holding the database, a disk with
   * nothing left on it, a file written by a newer build — and the alternative to
   * showing it is the feature quietly not existing. A failed load used to leave
   * no marks and no message; a failed write used to make the menu row a no-op.
   */
  error: string | null;
}

export function useAnnotations(
  doc: Document | null,
  article: HTMLElement | null,
  /** Whether this view is the one on screen. Background tabs stay mounted, and
   *  the highlight registry is one per page — see the paint effect. */
  visible: boolean,
): AnnotationState {
  const [marks, setMarks] = useState<ResolvedAnnotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supported = useRef(supportsHighlights());

  /**
   * Which document `marks` describes.
   *
   * Resolving is asynchronous, so between a new document arriving and its marks
   * coming back there is a render where `marks` holds the *previous* document's
   * offsets. Painting those is not a harmless no-op: `domPositionOf` falls back
   * to the nearest position it can find rather than refusing, so offsets
   * belonging to another file are clamped onto this one and painted — the
   * wrong-words failure the orphan rule exists to prevent, arriving from the one
   * direction the anchor never sees. The same gap opens on every save, where it
   * shows as marks jumping while the reader types.
   *
   * Compared rather than cleared, because clearing would flash the marks off and
   * on again for the far more common case of a re-render that resolves to the
   * same thing.
   */
  const describes = useRef<string | null>(null);

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
      describes.current = null;
      setMarks([]);
      return;
    }

    // A holder rather than a bare `let`: the only assignment is in the cleanup
    // closure, which is created after the one that reads it, so type-aware lint
    // narrows a plain boolean to `false` and calls the guard dead.
    const live = { current: true };
    void (async () => {
      try {
        await load();
      } catch (cause) {
        // Reported rather than swallowed. `void` satisfies `no-floating-promises`
        // without handling anything, which is the shape AGENTS.md names as the
        // dead-links bug of v1.0.0 — a rejection nobody saw for a whole release.
        if (live.current) setError(message(cause));
      }
    })();

    async function load() {
      let stored = await listAnnotations(path!);
      // Nothing here may mean nothing was ever marked, or may mean this file has
      // been renamed out from under its marks. Only worth asking in the empty
      // case, which is also the only case `relink` will act on.
      if (stored.length === 0 && contentHash.length > 0) {
        await relinkAnnotations(path!, contentHash);
        if (!live.current) return;
        // Listed again unconditionally, rather than only when the call reported
        // moving something. Two of these can be in flight at once — an effect
        // that re-runs while the first is awaiting, which a watcher reload or a
        // save is enough to cause — and then the first does the move and is
        // cancelled before it can list, while the second is told nothing moved
        // because the first already moved it. Both give up, the rows sit under
        // the new path, and the reader sees no marks until something else
        // reloads the document. Trusting the count is what makes that possible;
        // asking again costs one indexed query on a document with no marks.
        stored = await listAnnotations(path!);
      }
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

      describes.current = key(path!, contentHash);
      setMarks(resolved);
      setError(null);
      // The one call that stays fire-and-forget, and the only one that can
      // afford to: the marks are already correct on screen, and a failure to
      // persist costs a search next time rather than anything the reader sees.
      if (moved.length > 0) await reanchorAnnotations(moved).catch(() => undefined);
    }

    return () => {
      live.current = false;
    };
  }, [path, source, contentHash]);

  // Paint after every render of the document, not only when the marks change:
  // `mirror` replaces the blocks an edit touched, and a Range holds the *node*
  // it was built over. A replaced node leaves its range pointing at something no
  // longer in the tree, which paints nothing and reports no error.
  //
  // **Only the view on screen paints, and that is a correctness rule rather than
  // an optimisation.** The highlight registry is one per page, and
  // `applyHighlights` replaces the whole of it — a slot with nothing in it is
  // deleted, not left alone, because a stale set outliving its document is worse
  // than none. Every mounted view running this would therefore have the last one
  // to render win: `DocumentDeck` keeps background tabs mounted, and the
  // comparison pane mounts a second `DocumentView` whose annotations are off
  // entirely, so merely opening the pane used to wipe the deck's marks. `visible`
  // is a dependency as well as a guard, so coming back to a tab repaints it —
  // nothing else in here changes when a tab is re-shown.
  useEffect(() => {
    if (!article || !supported.current || !visible || !path) return;
    // Stale marks describe a different file, or this file before an edit moved
    // everything below the change. Painting them puts a highlight on words
    // nobody marked; waiting a beat for the resolve to land does not.
    if (describes.current !== key(path, contentHash)) return;

    const paintable: PaintableMark[] = marks.flatMap((mark) =>
      mark.range ? [{ range: mark.range, color: mark.color }] : [],
    );
    applyHighlights(paintRanges(article, doc?.blocks ?? [], paintable));
  }, [article, marks, visible, path, contentHash, doc?.blocks, doc?.html]);

  // Taking its own marks off on the way out, for the same reason the paint above
  // is gated: the registry is one per page. **The guard has to be here too, and
  // leaving it off was the same bug in its other half.** This destructor runs on
  // unmount whatever the view was doing, so a background tab being closed or
  // evicted, or the comparison pane — which never painted anything, since its
  // annotations are off — cleared the marks of the document actually on screen,
  // and nothing repainted because nothing in the visible view had changed.
  //
  // A ref rather than the values themselves: this must run *only* on unmount and
  // only for the view that owns what is registered, so it cannot depend on
  // `visible` or `path` without also firing every time either of them changes.
  const owns = useRef(false);
  owns.current = visible && path !== null;
  useEffect(
    () => () => {
      if (owns.current) clearHighlights();
    },
    [],
  );

  const highlight = useCallback(
    (range: SourceRange, color: string) => {
      if (!path) return;
      const anchor = createAnchor(source, range, contentHash);
      if (!anchor) return;

      const against = key(path, contentHash);
      void createAnnotation({ path, color, body: "", ...anchor })
        .then((made) => {
          // The document may have been rewritten while the write was in flight —
          // the comparison pane exists to watch a file something else is
          // changing. Appending offsets computed against the old text would put
          // the mark a paragraph out, and the reload that is already coming will
          // list this row properly anyway.
          if (describes.current !== against) return;
          setMarks((current) => [
            ...current,
            { ...made, range: { start: anchor.startOffset, end: anchor.endOffset } },
          ]);
          setError(null);
        })
        .catch((cause: unknown) => {
          // Otherwise picking a colour is a silent no-op, which is the failure
          // mode a read-only document is carefully never allowed to have.
          setError(message(cause));
        });
    },
    [path, source, contentHash],
  );

  // The marks are read from a ref rather than from a state updater: a `setState`
  // updater has to be pure, and React — which double-invokes them under
  // StrictMode — is entitled to run it more than once. Deleting inside one sent
  // the delete twice per mark.
  const latest = useRef(marks);
  latest.current = marks;

  const removeAt = useCallback((range: SourceRange) => {
    const gone = latest.current.filter((mark) => overlaps(mark.range, range));
    if (gone.length === 0) return;

    setMarks((current) => current.filter((mark) => !gone.includes(mark)));
    for (const mark of gone) {
      void deleteAnnotation(mark.id).catch((cause: unknown) => {
        // Put it back rather than leaving the reader with a mark that is gone
        // from the page and still in the database — it would reappear on the
        // next load with no explanation.
        setMarks((current) => (current.includes(mark) ? current : [...current, mark]));
        setError(message(cause));
      });
    }
  }, []);

  return { marks, highlight, removeAt, supported: supported.current, error };
}

/** What `marks` was resolved against. Both halves matter: the path alone misses
 *  an edit, and the hash alone would collide across two identical files. */
function key(path: string, contentHash: string): string {
  return `${path} ${contentHash}`;
}

/** `LindoError` serializes to a plain string, so an error from Rust is already
 *  written for a reader; anything else is a bug here and says so. */
function message(cause: unknown): string {
  if (typeof cause === "string") return cause;
  return cause instanceof Error ? cause.message : "Something went wrong with your annotations.";
}
