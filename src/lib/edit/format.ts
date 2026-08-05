import type { SourceRange } from "./selection";

/**
 * The formatting commands, as transforms of the Markdown source.
 *
 * Every one of them **toggles**. Choosing Bold on text that is already bold
 * unwraps it, and choosing Heading on a line that is already `## ` removes it.
 * That is what makes this read as a formatting menu rather than a snippet
 * inserter, and it is the difference between a control a reader trusts and one
 * they have to undo by hand.
 */

export type WrapCommand = "bold" | "italic" | "code" | "strikethrough";
export type LineCommand =
  | "heading1"
  | "heading2"
  | "heading3"
  | "bullet"
  | "numbered"
  | "task"
  | "quote";
export type FormatCommand = WrapCommand | LineCommand;

const WRAPPERS: Record<WrapCommand, string> = {
  bold: "**",
  italic: "_",
  code: "`",
  strikethrough: "~~",
};

const PREFIXES: Record<LineCommand, string> = {
  heading1: "# ",
  heading2: "## ",
  heading3: "### ",
  bullet: "- ",
  numbered: "1. ",
  task: "- [ ] ",
  quote: "> ",
};

/** Anything this menu can put at the start of a line. Used to strip whichever
 *  one is already there before applying another, so choosing Bullet on a
 *  heading replaces it rather than producing `## - `. */
const ANY_PREFIX = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )?/;

/**
 * Which command a line's existing prefix corresponds to.
 *
 * Compared by kind rather than by text, because the prefixes overlap: `- [ ] `
 * starts with `- `, so a string comparison reads a task item as a bullet and
 * strips it instead of converting it. Numbering is the same story — `2. ` has to
 * count as the numbered list that `1. ` would create.
 */
function kindOf(existing: string): LineCommand | null {
  if (existing === "# ") return "heading1";
  if (existing === "## ") return "heading2";
  if (existing === "### ") return "heading3";
  if (existing === "> ") return "quote";
  if (/^[-*+] \[[ xX]\] $/.test(existing)) return "task";
  if (/^[-*+] $/.test(existing)) return "bullet";
  if (/^\d+[.)] $/.test(existing)) return "numbered";
  return null;
}

export interface Edit {
  source: string;
  /** Where the reader's selection should sit afterwards, so a toggle can be
   *  applied twice in a row without reselecting. */
  selection: SourceRange;
}

export function isWrapCommand(command: FormatCommand): command is WrapCommand {
  return command in WRAPPERS;
}

export function applyFormat(
  source: string,
  range: SourceRange,
  command: FormatCommand,
): Edit {
  return isWrapCommand(command)
    ? wrap(source, range, WRAPPERS[command])
    : prefixLines(source, range, command);
}

/**
 * Wraps the selection in `marker`, or removes it if it is already wrapped.
 *
 * The marker is looked for just outside the selection as well as just inside it:
 * a reader who double-clicks a bold word selects `bold`, not `**bold**`, and
 * would otherwise get `****bold****`.
 */
function wrap(source: string, range: SourceRange, marker: string): Edit {
  const { start, end } = range;
  const width = marker.length;

  const outside =
    source.slice(start - width, start) === marker &&
    source.slice(end, end + width) === marker;
  if (outside) {
    const inner = source.slice(start, end);
    return {
      source: source.slice(0, start - width) + inner + source.slice(end + width),
      selection: { start: start - width, end: end - width },
    };
  }

  const selected = source.slice(start, end);
  if (
    selected.length >= width * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(width, -width);
    return {
      source: source.slice(0, start) + inner + source.slice(end),
      selection: { start, end: start + inner.length },
    };
  }

  return {
    source: source.slice(0, start) + marker + selected + marker + source.slice(end),
    selection: { start: start + width, end: end + width },
  };
}

/**
 * Puts `prefix` at the start of every line the selection touches, or takes it
 * off if every one of them already has it.
 *
 * All-or-nothing on purpose: with a mixed selection the reader means "make these
 * all headings", and toggling each line independently would scramble them.
 */
function prefixLines(
  source: string,
  range: SourceRange,
  command: LineCommand,
): Edit {
  const prefix = PREFIXES[command];
  const from = source.lastIndexOf("\n", Math.max(0, range.start - 1)) + 1;
  const to = source.indexOf("\n", range.end);
  const stop = to === -1 ? source.length : to;

  const lines = source.slice(from, stop).split("\n");
  const split = (line: string) => {
    const [, indent = "", existing = ""] = ANY_PREFIX.exec(line) ?? [];
    return { indent, existing, body: line.slice(indent.length + existing.length) };
  };

  const removing = lines.every(
    (line) => line.trim() === "" || kindOf(split(line).existing) === command,
  );

  const rewritten = lines.map((line) => {
    if (line.trim() === "") return line;
    const { indent, body } = split(line);
    return removing ? indent + body : indent + prefix + body;
  });

  const replacement = rewritten.join("\n");

  // The selection has to keep covering the same words. Its start moves by
  // however much the *first* line grew or shrank; its end by the total, since
  // every line before it has shifted too.
  const startDelta = (rewritten[0]?.length ?? 0) - (lines[0]?.length ?? 0);
  const totalDelta = replacement.length - (stop - from);

  return {
    source: source.slice(0, from) + replacement + source.slice(stop),
    selection: {
      start: Math.max(from, range.start + startDelta),
      end: Math.max(from, range.end + totalDelta),
    },
  };
}
