/**
 * Ticking a task-list checkbox — the one edit a reader can make without a caret.
 *
 * It is also the whole editing architecture in miniature: the click is applied
 * to the **Markdown source**, which is then re-rendered. Nothing is read back
 * out of the DOM except one number, the line the item came from.
 */

/** The list marker, the box, and the state inside it. The first group absorbs
 *  leading whitespace so nested items work and `>` so quoted ones do; both
 *  `-`/`*`/`+` and `1.`/`1)` bullets are accepted because all of them are GFM
 *  task lists. */
const TASK_MARKER = /^([\s>]*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * Flips the task marker on `line` (1-based) of `source`, returning the new
 * source — or `null` if that line has no task marker, which means the click did
 * not come from where we think it did and nothing should be written.
 */
export function toggleTask(source: string, line: number): string | null {
  const start = offsetOfLine(source, line);
  if (start === null) return null;

  const newline = source.indexOf("\n", start);
  const text = source.slice(start, newline === -1 ? undefined : newline);

  const match = TASK_MARKER.exec(text);
  const prefix = match?.[1];
  if (!match || prefix === undefined) return null;

  const at = start + prefix.length;
  const flipped = match[2] === " " ? "x" : " ";
  return source.slice(0, at) + flipped + source.slice(at + 1);
}

/** Byte offset where a 1-based line starts, or `null` if the document has no
 *  such line. */
function offsetOfLine(source: string, line: number): number | null {
  if (line < 1) return null;
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const newline = source.indexOf("\n", offset);
    if (newline === -1) return null;
    offset = newline + 1;
  }
  return offset <= source.length ? offset : null;
}

/** The 1-based start line in `data-sourcepos`, which comrak writes as
 *  `"12:1-14:37"`. */
export function startLine(sourcepos: string | null | undefined): number | null {
  if (!sourcepos) return null;
  const line = Number.parseInt(sourcepos.split(":")[0] ?? "", 10);
  return Number.isFinite(line) ? line : null;
}

export interface TaskHandlers {
  /** Applies the edited source. Resolves false if the write was refused, which
   *  is when the optimistic tick has to be taken back. */
  save: (source: string) => Promise<boolean>;
  /** The document's Markdown, as it stands right now. */
  source: () => string;
}

/**
 * Returns a click handler for the document root, delegated the same way links
 * are — a long checklist would otherwise mean a listener per box, replaced on
 * every render.
 *
 * The tick is applied immediately and taken back if the save fails. A checkbox
 * that waits for a disk write before moving feels broken, and the write is
 * nearly always going to succeed.
 */
export function taskClickHandler(handlers: TaskHandlers) {
  return (event: MouseEvent): void => {
    const box = event.target as HTMLInputElement | null;
    if (box?.tagName !== "INPUT" || box.type !== "checkbox") return;

    // The browser flips the box before the click handler ever runs, so every
    // path out of here that does not write has to put it back. A box showing a
    // state the file does not have is worse than one that refuses to move.
    const shown = box.checked;
    const revert = () => {
      box.checked = !shown;
    };

    const line = startLine(box.closest("li")?.getAttribute("data-sourcepos"));
    if (line === null) {
      revert();
      return;
    }

    const edited = toggleTask(handlers.source(), line);
    if (edited === null) {
      revert();
      return;
    }

    // Rejection as well as `false`: `save` reports a refused write by resolving
    // false, but a bug in it must not leave the box showing a state the file
    // does not have.
    void handlers.save(edited).then(
      (saved) => {
        if (!saved) revert();
      },
      () => {
        revert();
      },
    );
  };
}
