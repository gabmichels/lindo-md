import type { SourceRange } from "./selection";

/**
 * Translating a `beforeinput` event into an edit of the Markdown source.
 *
 * The browser is never allowed to mutate the document: every input is
 * `preventDefault`ed and turned into a change to the source, which is then
 * re-rendered. That is what keeps the map valid — it always describes the
 * document that is actually on screen — and what keeps an HTML-to-Markdown
 * serializer out of the codebase.
 */

export interface InputEdit {
  source: string;
  /** Where the caret ends up, as an offset into the new source. */
  caret: number;
  /**
   * Whether the rendered view has to be rebuilt before the reader can carry on.
   *
   * Typing a letter into a paragraph leaves the structure alone, so the
   * character can be dropped straight into the text node and the re-render can
   * wait for a pause. A newline cannot: it may end a paragraph, close a list, or
   * start a fence, and patching that in place would mean deciding what the
   * Markdown now means — exactly the job this design refuses to do in the DOM.
   */
  structural: boolean;
}

/** Input types that delete rather than insert, and how far. */
const DELETIONS: Record<string, "backward" | "forward" | "word-backward" | "word-forward"> = {
  deleteContentBackward: "backward",
  deleteContent: "backward",
  deleteWordBackward: "word-backward",
  deleteWordForward: "word-forward",
  deleteContentForward: "forward",
};

export function applyInput(
  source: string,
  range: SourceRange,
  inputType: string,
  data: string | null,
): InputEdit | null {
  if (inputType in DELETIONS) {
    return remove(source, range, DELETIONS[inputType]!);
  }

  switch (inputType) {
    case "insertText":
    case "insertReplacementText":
    case "insertCompositionText":
      return data === null ? null : insert(source, range, data);

    // Enter. A blank line is what separates two blocks in Markdown; without it
    // the next line would be a lazy continuation of this paragraph.
    case "insertParagraph":
      return insert(source, range, "\n\n");

    // Shift+Enter. Two trailing spaces are GFM's hard break — the one spelling
    // that survives a round trip through every other Markdown tool.
    case "insertLineBreak":
      return insert(source, range, "  \n");

    case "insertFromPaste":
    case "insertFromDrop":
      return data === null ? null : insert(source, range, data);

    default:
      return null;
  }
}

function insert(source: string, range: SourceRange, text: string): InputEdit {
  return {
    source: source.slice(0, range.start) + text + source.slice(range.end),
    caret: range.start + text.length,
    // A newline can end a paragraph, close a list, or open a fence. Anything
    // else is a character inside a line, which the renderer will reinterpret at
    // the next pause without the structure moving underneath the reader.
    structural: text.includes("\n"),
  };
}

function remove(
  source: string,
  range: SourceRange,
  how: "backward" | "forward" | "word-backward" | "word-forward",
): InputEdit | null {
  // A selection is deleted whole, whichever key asked for it.
  if (range.end > range.start) {
    return {
      source: source.slice(0, range.start) + source.slice(range.end),
      caret: range.start,
      structural: source.slice(range.start, range.end).includes("\n"),
    };
  }

  const at = range.start;
  let from = at;
  let to = at;

  switch (how) {
    case "backward":
      from = previousCharacter(source, at);
      break;
    case "forward":
      to = nextCharacter(source, at);
      break;
    case "word-backward":
      from = wordStart(source, at);
      break;
    case "word-forward":
      to = wordEnd(source, at);
      break;
  }

  if (from === to) return null;
  return {
    source: source.slice(0, from) + source.slice(to),
    caret: from,
    structural: source.slice(from, to).includes("\n"),
  };
}

/** One character back, not one UTF-16 unit: an emoji is a surrogate pair and
 *  deleting half of it would leave a broken character in the file. */
function previousCharacter(source: string, at: number): number {
  if (at <= 0) return at;
  const before = source.codePointAt(at - 2);
  return before !== undefined && before > 0xffff ? at - 2 : at - 1;
}

function nextCharacter(source: string, at: number): number {
  if (at >= source.length) return at;
  const next = source.codePointAt(at);
  return next !== undefined && next > 0xffff ? at + 2 : at + 1;
}

const WORD = /[\p{L}\p{N}_]/u;

function wordStart(source: string, at: number): number {
  let index = at;
  while (index > 0 && !WORD.test(source[index - 1]!)) index--;
  while (index > 0 && WORD.test(source[index - 1]!)) index--;
  return index;
}

function wordEnd(source: string, at: number): number {
  let index = at;
  while (index < source.length && !WORD.test(source[index]!)) index++;
  while (index < source.length && WORD.test(source[index]!)) index++;
  return index;
}
