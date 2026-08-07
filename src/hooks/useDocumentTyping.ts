import { useCallback, useEffect, useRef } from "react";

import { applyInput } from "@/lib/edit/input";
import { ATOM_SELECTOR, selectionRange, type SourceRange } from "@/lib/edit/selection";
import type { Document } from "@/lib/ipc";

/**
 * Typing directly into the rendered document.
 *
 * The browser never edits anything. Every `beforeinput` is cancelled, turned
 * into a change to the Markdown, and the document is re-rendered from that —
 * so the block map always describes what is actually on screen, and no code
 * anywhere has to read structure back out of the DOM.
 *
 * Two speeds, because re-rendering on every keystroke would mean re-running
 * Shiki and Mermaid over the whole document sixty times a sentence:
 *
 * - **A character inside a line** is dropped straight into the text node and
 *   the re-render waits for a pause. The reader sees it immediately; the
 *   Markdown catches up a moment later.
 * - **Anything that moves structure** — a newline, a paste, a deletion across a
 *   line — is written and re-rendered at once, because patching it in place
 *   would mean deciding what the Markdown now means.
 *
 * While a pause is pending the map is a version behind, so the caret cannot be
 * resolved from the DOM. It is instead tracked arithmetically from the edit
 * that moved it, and **anything that could move the caret another way flushes
 * first** — a click, an arrow key, losing focus. That is the invariant the whole
 * hook rests on: while there are unsaved characters, the only thing that
 * happens is more typing at the tracked caret.
 */

/** Long enough that ordinary typing does not trigger it, short enough that the
 *  rendering never feels detached from the file. */
const SETTLE_MS = 500;

interface Options {
  article: React.RefObject<HTMLElement | null>;
  document: Document;
  onSave: (source: string) => Promise<boolean>;
  /** Shared with `DocumentView`, which puts the caret back after the re-render. */
  restoring: React.RefObject<SourceRange | null>;
}

export function useDocumentTyping({ article, document: doc, onSave, restoring }: Options) {
  /** Edited source not yet written, or null when the file is up to date. */
  const pending = useRef<string | null>(null);
  /** Where the caret is, as an offset into `pending`. Only meaningful while
   *  dirty — otherwise the DOM is the authority. */
  const caret = useRef<number | null>(null);
  const timer = useRef<number | null>(null);

  const latest = useRef(doc);
  latest.current = doc;
  const save = useRef(onSave);
  save.current = onSave;

  /** True between asking for a save and the rendered document coming back. */
  const inFlight = useRef(false);

  const flush = useCallback(
    (force = false) => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      const next = pending.current;
      if (next === null || inFlight.current) return;

      // Markdown strips the whitespace at the end of a line, so a space typed
      // there has no character of its own once rendered. Re-rendering now would
      // leave the caret with nowhere to be, and putting it at the nearest place
      // instead means the next word lands in front of the space rather than after
      // it. Waiting costs nothing: the space is only worth writing once there is
      // something after it, and blur forces the write regardless.
      if (!force && caret.current !== null && inStrippedSpace(next, caret.current)) {
        timer.current = window.setTimeout(flush, SETTLE_MS);
        return;
      }

      // `pending` and `caret` deliberately survive the save. Clearing them here
      // would mark the view clean while the screen still shows unsaved text and
      // the map still describes the previous document — and the next keystroke
      // would then resolve its position against a map that does not match what
      // the reader is looking at. They are cleared when the render catches up.
      inFlight.current = true;
      const at = caret.current;
      if (at !== null) restoring.current = { start: at, end: at };

      void save.current(next).then((saved) => {
        inFlight.current = false;
        // A refused write leaves the document as it was; the caret has nowhere
        // meaningful to go, so it is left where the reader put it.
        if (!saved) restoring.current = null;
        // More was typed while that was in the air.
        if (pending.current !== null && pending.current !== latest.current.source) {
          flush();
        }
      });
    },
    [restoring],
  );

  // The render has caught up: what is on screen is now what was saved, so the
  // DOM and the map agree again and the tracked caret can be let go.
  useEffect(() => {
    if (pending.current !== null && pending.current === doc.source) {
      pending.current = null;
      caret.current = null;
    }
  }, [doc.source]);

  // Atoms are inert to the caret. `contenteditable="false"` is what makes the
  // browser treat each as one indivisible thing — arrow keys step over it,
  // selection takes it whole — rather than letting a caret inside a highlighted
  // code block, where the text on screen is not the text in the file.
  useEffect(() => {
    const root = article.current;
    if (!root) return;
    for (const atom of root.querySelectorAll<HTMLElement>(ATOM_SELECTOR)) {
      // Checked rather than assigned unconditionally: a re-render now reuses the
      // nodes it did not change (`lib/render/mirror.ts`), so most of these are
      // already marked, and writing `contentEditable` invalidates the editing
      // state of the element whether or not the value differs.
      if (atom.contentEditable !== "false") atom.contentEditable = "false";
    }
  }, [article, doc.html]);

  useEffect(() => {
    const root = article.current;
    if (!root) return;
    // A read-only document never registers the listener at all. `contentEditable`
    // is already off for these, which stops ordinary typing, but an IME
    // composition can still deliver `beforeinput` to a non-editable subtree — and
    // this handler would then try to map an edit onto a document with no block map
    // to map it into.
    if (!doc.editable) return;

    const onBeforeInput = (event: InputEvent) => {
      // Nothing the browser does to this document is allowed to stand.
      event.preventDefault();

      const source = pending.current ?? latest.current.source;
      const selection = window.getSelection();
      const collapsed = selection?.isCollapsed ?? false;

      let range: SourceRange | null;
      if (pending.current !== null && caret.current !== null && collapsed) {
        // Mid-pause: the map is stale, so the tracked caret is the only
        // trustworthy answer.
        range = { start: caret.current, end: caret.current };
      } else {
        range = selectionRange(latest.current.blocks, selection);
      }
      // Nothing to edit: the caret is in a code fence, or the selection spans
      // two blocks and so covers markup between them. The input is dropped —
      // the event is already cancelled, and letting the browser have it instead
      // would put the DOM out of step with the file, which is the one thing this
      // design does not survive. Typing over a multi-block selection therefore
      // does nothing at present; it needs a rule for what replacing the markup
      // between two blocks means.
      if (!range) return;

      const edit = applyInput(source, range, event.inputType, dataOf(event));
      if (!edit) return;

      pending.current = edit.source;
      caret.current = edit.caret;

      if (edit.structural || !applyToDom(event, selection)) {
        flush();
        return;
      }

      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SETTLE_MS);
    };

    // Everything that could move the caret without typing. Flushing here is
    // what lets the fast path trust its tracked offset — and it is forced,
    // because the caret is about to move anyway, so there is nothing left to
    // protect by waiting.
    const onMove = (event: Event) => {
      if (event instanceof KeyboardEvent && !MOVES.has(event.key)) return;
      flush(true);
    };
    const onLeave = () => {
      flush(true);
    };

    root.addEventListener("beforeinput", onBeforeInput as EventListener);
    root.addEventListener("pointerdown", onMove);
    root.addEventListener("keydown", onMove);
    root.addEventListener("blur", onLeave);

    return () => {
      root.removeEventListener("beforeinput", onBeforeInput as EventListener);
      root.removeEventListener("pointerdown", onMove);
      root.removeEventListener("keydown", onMove);
      root.removeEventListener("blur", onLeave);
      // Leaving the view must not lose what was typed into it.
      flush(true);
    };
  }, [article, flush, doc.editable]);
}

const MOVES = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** Whether the caret sits in whitespace at the end of a line — the whitespace
 *  Markdown discards, which therefore has no position in the rendered document. */
function inStrippedSpace(source: string, at: number): boolean {
  if (at === 0 || !/\s/.test(source[at - 1] ?? "")) return false;
  const newline = source.indexOf("\n", at);
  const rest = newline === -1 ? source.slice(at) : source.slice(at, newline);
  return rest.trim() === "";
}

function dataOf(event: InputEvent): string | null {
  if (event.data !== null) return event.data;
  // A paste arrives as a data transfer rather than as `data`.
  return event.dataTransfer?.getData("text/plain") ?? null;
}

/**
 * Shows a change immediately, without waiting for the round trip.
 *
 * Only edits confined to one text node with a collapsed caret: those cannot
 * change the shape of the document, so the map stays usable until the pause.
 * Returns false for anything else, which tells the caller to re-render now.
 *
 * Deleting matters here as much as typing. Without it every backspace forced a
 * save, and a burst of them put several in the air at once — each carrying a
 * fingerprint of the document as it was before the others landed.
 */
function applyToDom(event: InputEvent, selection: Selection | null): boolean {
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;

  const text = node as Text;
  const value = text.nodeValue ?? "";
  const at = range.startOffset;

  let from = at;
  let to = at;
  let inserted = "";

  switch (event.inputType) {
    case "insertText":
      if (!event.data) return false;
      inserted = visible(event.data, value, at);
      break;
    case "deleteContentBackward":
      // Not at the start of the node: crossing out of it could mean leaving the
      // block entirely, which is structural.
      if (at === 0) return false;
      from = at - surrogateWidth(value, at);
      break;
    case "deleteContentForward":
      if (at >= value.length) return false;
      to = at + surrogateWidth(value, at + 1);
      break;
    default:
      return false;
  }

  text.nodeValue = value.slice(0, from) + inserted + value.slice(to);

  const moved = document.createRange();
  moved.setStart(text, from + inserted.length);
  moved.collapse(true);
  selection.removeAllRanges();
  selection.addRange(moved);
  return true;
}

/**
 * The character to put in the DOM so the reader can see they typed it.
 *
 * HTML collapses a run of whitespace and drops it entirely at the end of a
 * line, so a space typed there changes the text without changing the picture —
 * the caret does not move and it looks as though the key did nothing. Browsers
 * paper over this in `contenteditable` by inserting a non-breaking space; since
 * every insertion here is made by hand, this has to do the same.
 *
 * Only the *rendered* character changes. What goes into the file is the space
 * the reader actually typed, and the next render replaces this node from the
 * source anyway.
 */
function visible(data: string, value: string, at: number): string {
  if (data !== " ") return data;
  const collapses = at === value.length || value[at - 1] === " " || value[at] === " ";
  // Written as an escape, not a literal: the two are indistinguishable on
  // screen and which one this is happens to be the whole point.
  return collapses ? "\u00a0" : data;
}

/** 2 when the character ending at `at` is half of a surrogate pair, else 1 —
 *  so an emoji is taken whole rather than broken in half. */
function surrogateWidth(value: string, at: number): number {
  const code = value.codePointAt(at - 2);
  return code !== undefined && code > 0xffff ? 2 : 1;
}
