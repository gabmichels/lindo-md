import { resolveAnchor } from "@/lib/annotate/anchor";
import type { SourceRange } from "@/lib/edit/selection";
import type { Annotation, BlockMap, Reanchor } from "@/lib/ipc";

/**
 * Where a document's stored marks are *now*.
 *
 * Split out of `useAnnotations` because there are two callers rather than one:
 * the view that paints marks, and the export that writes them into a copy of the
 * file. Both have to answer the same question against the same document, and the
 * answer has three cases — still there, moved, gone — which is exactly the kind
 * of rule that goes wrong when it exists twice. The export in particular must
 * not invent a fourth: a mark it cannot place goes in the file as an unplaced
 * note, never onto a nearby sentence.
 */

/** An annotation plus where it currently resolves, or null for an orphan. */
export interface ResolvedAnnotation extends Annotation {
  range: SourceRange | null;
}

export interface Resolution {
  resolved: ResolvedAnnotation[];
  /** Marks whose offsets were re-found, for writing back so the search runs
   *  once rather than on every load. Empty when nothing moved. */
  moved: Reanchor[];
}

export function resolveAll(
  source: string,
  contentHash: string,
  blocks: readonly BlockMap[],
  stored: readonly Annotation[],
): Resolution {
  // Where a caret can go, taken from the block map. Without it the search
  // re-finds a quote inside a link target or a fence and then freezes there.
  const covered = blocks.flatMap((block) =>
    block.runs.map((run) => ({ start: run.sourceStart, end: run.sourceEnd })),
  );

  const resolved: ResolvedAnnotation[] = [];
  const moved: Reanchor[] = [];
  for (const annotation of stored) {
    const outcome = resolveAnchor(source, contentHash, annotation, covered);
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
  return { resolved, moved };
}
