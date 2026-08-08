//! Rendered text ⇄ source offset mapping.
//!
//! For every block that holds inline content, the text a reader can put a caret
//! in is aligned back to exact byte offsets in the Markdown source. That is what
//! lets an edit made in the *rendered* view be applied to the file without ever
//! converting HTML back into Markdown: the source stays the truth and the DOM is
//! only ever asked "where am I".
//!
//! Alignment is **per block**, never global. comrak writes literal newlines
//! between block elements, and those become text nodes in the DOM; aligning the
//! whole document as one string would make every such newline a chance to drift,
//! and drift accumulates. Aligning inside one block means inter-block whitespace
//! is never consulted and a failure stays local to the paragraph that caused it.
//!
//! Rendered text is **not** a substring of the source. Five things spell a
//! character differently from how it renders, and each is handled in `consume`
//! or by matching a whole run at once:
//!
//! | Source | Renders as |
//! | --- | --- |
//! | `\*` | `*` |
//! | `&amp;` | `&` |
//! | `--`, `...` (smart punctuation on) | `–`, `…` |
//! | `"` (smart punctuation on) | `“` or `”`, depending on context |
//! | `:warning:` | `⚠` **plus a variation selector** — two code points |
//!
//! Some subtrees are skipped entirely rather than mapped: see `is_skipped`.
//!
//! Verified against `test/fixtures/kitchen-sink.md` in the real WebView2, after
//! Shiki, KaTeX and Mermaid have run: 76 blocks matched byte-for-byte, 0
//! differing, 0 unaccounted. The one known gap is description terms — comrak
//! reports a term on line 56 as `57:1-57:0`, pointing at the definition below
//! it, so they are excluded (see `is_inline_container`).
//!
//! `for_webview` is what leaves this module: aligned blocks only, with offsets
//! converted from byte indices to UTF-16 ones, because the webview holds the
//! source as a JavaScript string.

use comrak::nodes::{AstNode, NodeValue};
use comrak::Arena;
use serde::Serialize;

use crate::markdown::{self, RenderOptions};

/// One run of caret-addressable text. `source[source_start..source_end]` is the
/// Markdown that produced `text` — but it is **not** necessarily equal to it:
/// `\*` is two source bytes for one rendered character, and `&amp;` is five.
/// The two sides therefore advance at different rates, which is why the run
/// carries a source *range* rather than the length of its text.
///
/// **Offsets are UTF-16 code units once serialized**, not bytes. The webview
/// holds the source as a JavaScript string and indexes it that way; handing it
/// byte offsets would put the caret in the wrong place in any document
/// containing an accent, a dash, or an emoji — which is to say most of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    pub text: String,
    pub source_start: usize,
    pub source_end: usize,
}

/// Byte offset → UTF-16 offset, for the boundary between Rust and the webview.
///
/// Recorded at each character boundary and searched, rather than counted from
/// the start of the document for every offset — a long document has thousands
/// of runs, and re-counting for each would make opening one quadratic.
struct Utf16Index(Vec<(usize, usize)>);

impl Utf16Index {
    fn new(source: &str) -> Self {
        let mut pairs = Vec::with_capacity(source.len() + 1);
        let mut units = 0usize;
        for (byte, character) in source.char_indices() {
            pairs.push((byte, units));
            units += character.len_utf16();
        }
        pairs.push((source.len(), units));
        Self(pairs)
    }

    fn at(&self, byte: usize) -> usize {
        match self.0.binary_search_by_key(&byte, |(at, _)| *at) {
            // `binary_search_by_key` returning Ok guarantees the index is in range.
            #[allow(
                clippy::indexing_slicing,
                reason = "index came from a successful binary_search"
            )]
            Ok(index) => self.0[index].1,
            // Mid-character can only happen if an offset was built wrongly;
            // rounding down keeps the caret in the document rather than panicking.
            Err(index) => self.0.get(index.saturating_sub(1)).map_or(0, |(_, u)| *u),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Alignment {
    /// Every text run in the block was located in its own source slice.
    Exact,
    /// A run could not be found. Carries the run that failed, for the report.
    Failed(String),
}

/// Four fields never leave Rust: they exist so that a failing alignment can say
/// *which* block and *what* text, which is the difference between a fixable
/// report and "some block somewhere did not line up". They are read by the tests
/// and by the DOM-comparison dump, not by the app.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockMap {
    #[serde(skip)]
    #[allow(dead_code)]
    pub kind: String,
    /// Byte-for-byte the element's `data-sourcepos` attribute, which is how the
    /// webview correlates a node it is standing in with its entry here.
    pub sourcepos: String,
    #[serde(skip)]
    #[allow(dead_code)]
    pub line: usize,
    /// The block's own byte range in the source. Bytes, not UTF-16 — this one is
    /// never serialized.
    #[serde(skip)]
    #[allow(dead_code)]
    pub source: (usize, usize),
    pub runs: Vec<TextRun>,
    /// False when some of this block's text could not be located in the source.
    /// The webview refuses to edit such a block rather than guessing — a wrong
    /// offset does not misplace a caret, it corrupts a file.
    #[serde(rename = "aligned")]
    pub is_aligned: bool,
    #[serde(skip)]
    #[allow(dead_code)]
    pub alignment: Alignment,
}

/// Byte offset of the start of each 1-based line, so a comrak `Sourcepos`
/// (1-based line, 1-based **byte** column) becomes a byte offset.
struct LineIndex(Vec<usize>);

impl LineIndex {
    fn new(source: &str) -> Self {
        let mut starts = vec![0];
        starts.extend(
            source
                .char_indices()
                .filter(|(_, c)| *c == '\n')
                .map(|(i, _)| i + 1),
        );
        Self(starts)
    }

    fn offset(&self, line: usize, column: usize) -> usize {
        let start = self.0.get(line.saturating_sub(1)).copied().unwrap_or(0);
        start + column.saturating_sub(1)
    }
}

/// Deliberately excludes `DescriptionTerm`. comrak reports a degenerate,
/// wrong-line position for it — a term on line 56 comes back as `57:1-57:0`,
/// pointing at the definition below it — so a term cannot be located in the file
/// with any confidence. Description terms are therefore not editable in the
/// rendered view; the source view is where they get changed.
fn is_inline_container(value: &NodeValue) -> bool {
    matches!(
        value,
        NodeValue::Paragraph | NodeValue::Heading(_) | NodeValue::TableCell
    )
}

fn kind_of(value: &NodeValue) -> &'static str {
    match value {
        NodeValue::Paragraph => "paragraph",
        NodeValue::Heading(_) => "heading",
        NodeValue::TableCell => "table-cell",
        _ => "other",
    }
}

/// The literal text a node contributes to the rendered DOM, or `None` if it
/// contributes none of its own.
fn run_text(value: &NodeValue) -> Option<String> {
    match value {
        NodeValue::Text(text) => Some(text.clone()),
        NodeValue::Code(code) => Some(code.literal.clone()),
        // Both breaks put a newline in the block's text: a soft break renders as
        // a bare newline, a hard break as `<br />` followed by one.
        NodeValue::SoftBreak | NodeValue::LineBreak => Some("\n".to_owned()),
        // `:tada:` in the source, one emoji character in the output.
        NodeValue::ShortCode(code) => Some(code.emoji.clone()),
        _ => None,
    }
}

/// Nodes whose entire subtree is skipped, because the text inside them is not
/// text the reader can put a caret in:
///
/// - an image's children are its **alt text**, which renders as an attribute
/// - a footnote reference renders as a generated superscript number
/// - code, math and raw HTML are atoms — see the module docs
///
/// Skipping has to be by subtree, not by node: `descendants()` is flat, so
/// skipping only the image node itself would still walk its alt text.
fn is_skipped(value: &NodeValue) -> bool {
    matches!(
        value,
        NodeValue::Image(_)
            | NodeValue::FootnoteReference(_)
            | NodeValue::CodeBlock(_)
            | NodeValue::Math(_)
            | NodeValue::HtmlInline(_)
    )
}

/// The node whose rendered element actually holds this block's text.
///
/// A paragraph inside a **tight** list is not wrapped in `<p>` — its text lands
/// directly in the `<li>`. The same is true of a tight description list. Keying
/// such a block by the paragraph's own position would name an element that does
/// not exist in the document.
fn rendered_container<'a>(node: &'a AstNode<'a>) -> &'a AstNode<'a> {
    if !matches!(node.data.borrow().value, NodeValue::Paragraph) {
        return node;
    }
    let Some(parent) = node.parent() else {
        return node;
    };

    let tight = match &parent.data.borrow().value {
        // A task list item is its own node type, not an `Item` carrying a flag.
        NodeValue::Item(_) | NodeValue::TaskItem(_) => parent.parent().is_some_and(|list| {
            matches!(&list.data.borrow().value, NodeValue::List(list) if list.tight)
        }),
        NodeValue::DescriptionTerm => true,
        NodeValue::DescriptionDetails => parent.parent().is_some_and(|item| {
            matches!(&item.data.borrow().value, NodeValue::DescriptionItem(item) if item.tight)
        }),
        _ => false,
    };

    if tight {
        parent
    } else {
        node
    }
}

/// `settings` must be the settings the document was rendered with. The map
/// describes a specific rendering, not the file in the abstract: smart
/// punctuation alone changes what the reader's caret is sitting in.
pub fn build(source: &str, settings: RenderOptions) -> Vec<BlockMap> {
    let arena = Arena::new();
    let options = markdown::options(settings);

    let root = comrak::parse_document(&arena, source, &options);
    let index = LineIndex::new(source);
    let mut blocks = Vec::new();

    for node in root.descendants() {
        let value = node.data.borrow().value.clone();
        if !is_inline_container(&value) {
            continue;
        }

        let pos = node.data.borrow().sourcepos;
        let start = index.offset(pos.start.line, pos.start.column);
        // `end.column` is inclusive, and can run past the line on a construct
        // comrak measures loosely; clamp so slicing is always in bounds.
        let end = index
            .offset(pos.end.line, pos.end.column + 1)
            .min(source.len());
        if start >= end {
            continue;
        }

        // Keyed by the element that actually exists in the HTML, which for a
        // tight list is the `<li>` rather than the paragraph inside it.
        // Formatted exactly as comrak writes the attribute, so the two can be
        // compared as strings without either side reformatting.
        let container = rendered_container(node).data.borrow().sourcepos;
        let sourcepos = format!(
            "{}:{}-{}:{}",
            container.start.line, container.start.column, container.end.line, container.end.column
        );

        blocks.push(align_block(
            source,
            node,
            Span {
                kind: kind_of(&value),
                sourcepos,
                line: pos.start.line,
                start,
                end,
            },
            settings.smart_punctuation,
        ));
    }

    blocks
}

/// Where a block sits, in every form the rest of the module needs it: how it is
/// keyed, where it starts for a reader, and the byte range its text lives in.
struct Span {
    kind: &'static str,
    sourcepos: String,
    line: usize,
    start: usize,
    end: usize,
}

/// Locates each text run inside the block's own source slice by scanning
/// forward. Forward-only is what makes this safe: runs appear in the source in
/// the same order they appear in the output, so a cursor that only advances
/// cannot match text belonging to an earlier run.
fn align_block<'a>(source: &str, node: &'a AstNode<'a>, span: Span, smart: bool) -> BlockMap {
    let Span {
        kind,
        sourcepos,
        line,
        start,
        end,
    } = span;
    let slice = &source[start..end];
    let mut cursor = 0usize;
    let mut runs = Vec::new();
    let mut alignment = Alignment::Exact;

    let mut pieces = Vec::new();
    collect_text(node, &mut pieces);

    for piece in pieces {
        let (text, found) = match &piece {
            Piece::Text(text) => (text, scan_forward(slice, cursor, text, smart)),
            Piece::Emoji(text) => (text, scan_forward_shortcode(slice, cursor, text)),
        };

        match found {
            Some((from, to)) => {
                runs.push(TextRun {
                    text: text.clone(),
                    source_start: start + from,
                    source_end: start + to,
                });
                cursor = to;
            }
            None => {
                if matches!(alignment, Alignment::Exact) {
                    alignment = Alignment::Failed(text.clone());
                }
            }
        }
    }

    BlockMap {
        kind: kind.to_owned(),
        sourcepos,
        line,
        source: (start, end),
        runs,
        is_aligned: matches!(alignment, Alignment::Exact),
        alignment,
    }
}

/// The map as the webview needs it: only blocks whose text was located in full,
/// with every offset converted from a byte index to a UTF-16 one.
///
/// A partly-aligned block is dropped rather than sent. Editing through a wrong
/// offset does not misplace a caret, it corrupts the file, so a block we cannot
/// account for is one the rendered view will not edit.
pub fn for_webview(source: &str, settings: RenderOptions) -> Vec<BlockMap> {
    let index = Utf16Index::new(source);
    build(source, settings)
        .into_iter()
        .filter(|block| block.is_aligned && !block.runs.is_empty())
        .map(|mut block| {
            for run in &mut block.runs {
                run.source_start = index.at(run.source_start);
                run.source_end = index.at(run.source_end);
            }
            block
        })
        .collect()
}

/// Gathers this block's caret-addressable text in document order, descending
/// into everything except the subtrees `is_skipped` rules out.
fn collect_text<'a>(node: &'a AstNode<'a>, out: &mut Vec<Piece>) {
    for child in node.children() {
        let value = child.data.borrow().value.clone();
        if is_skipped(&value) {
            continue;
        }
        if let Some(text) = run_text(&value) {
            if !text.is_empty() {
                out.push(match value {
                    NodeValue::ShortCode(_) => Piece::Emoji(text),
                    _ => Piece::Text(text),
                });
            }
        }
        collect_text(child, out);
    }
}

/// An emoji is matched as one unit rather than character by character, because
/// the source spells it with a name and the output can be several code points —
/// `:warning:` is one shortcode but `⚠` plus a variation selector. Comparing per
/// character would consume the whole shortcode on the first of them and have
/// nothing left for the rest.
enum Piece {
    Text(String),
    Emoji(String),
}

/// Finds the next place at or after `from` where the source produces `text`,
/// returning the byte range it occupies. Forward-only: runs appear in the
/// source in output order, so a cursor that never rewinds cannot match text
/// belonging to a run already placed.
fn scan_forward(slice: &str, from: usize, text: &str, smart: bool) -> Option<(usize, usize)> {
    for (at, _) in slice[from..].char_indices() {
        let at = from + at;
        if let Some(end) = match_here(slice, at, text, smart) {
            return Some((at, end));
        }
    }
    None
}

/// Matches `text` against the source at `at`, consuming from both sides as they
/// correspond. A substring comparison cannot be used: the source spells some
/// characters with more bytes than they render to.
///
/// The two sides are consumed independently rather than one character each,
/// because a single source token can produce more than one character — `&nGg;`
/// is two code points, as is the emoji behind `:warning:`.
pub fn match_here(slice: &str, at: usize, text: &str, smart: bool) -> Option<usize> {
    let mut cursor = at;
    let mut rest = text;
    while !rest.is_empty() {
        let (source_width, text_width) = consume(slice, cursor, rest, smart)?;
        cursor += source_width;
        rest = &rest[text_width..];
    }
    Some(cursor)
}

/// How many source bytes at `at` are spent producing `expected`, or `None` if
/// the source there cannot produce it.
///
/// Asking "can this produce that" rather than "what does this produce" is
/// deliberate: with smart punctuation on, a `"` in the source becomes either a
/// left or a right curly quote depending on surrounding context, so there is no
/// single answer to decode *to* — but there is always a definite answer to
/// whether a given character was what it produced.
/// Returns `(source bytes spent, characters of `expected` produced)`.
fn consume(slice: &str, at: usize, expected: &str, smart: bool) -> Option<(usize, usize)> {
    let rest = slice.get(at..)?;
    let mut chars = rest.chars();
    let first = chars.next()?;
    let wanted = expected.chars().next()?;

    // CommonMark only honours a backslash before ASCII punctuation; anywhere
    // else the backslash is a literal character.
    if first == '\\' {
        if let Some(escaped) = chars.next() {
            if escaped.is_ascii_punctuation() && escaped == wanted {
                return Some((1 + escaped.len_utf8(), wanted.len_utf8()));
            }
        }
    }

    // An entity can produce more than one character, which is why this compares
    // against the whole of `expected` rather than one character of it.
    if first == '&' {
        if let Some((decoded, width)) = decode_entity(rest) {
            if expected.starts_with(&decoded) {
                return Some((width, decoded.len()));
            }
        }
    }

    // Longest first: `---` is an em dash, and testing `--` before it would eat
    // two of its three bytes and leave a stray hyphen behind.
    if smart {
        for (spelling, produced) in [("---", '\u{2014}'), ("--", '\u{2013}'), ("...", '\u{2026}')] {
            if wanted == produced && rest.starts_with(spelling) {
                return Some((spelling.len(), produced.len_utf8()));
            }
        }
        let curly = match first {
            '"' => matches!(wanted, '\u{201c}' | '\u{201d}'),
            '\'' => matches!(wanted, '\u{2018}' | '\u{2019}'),
            _ => false,
        };
        if curly {
            return Some((1, wanted.len_utf8()));
        }
    }

    (first == wanted).then(|| (first.len_utf8(), wanted.len_utf8()))
}

/// Finds the next `:shortcode:` at or after `from` that resolves to `emoji`.
fn scan_forward_shortcode(slice: &str, from: usize, emoji: &str) -> Option<(usize, usize)> {
    for (at, character) in slice[from..].char_indices() {
        if character != ':' {
            continue;
        }
        let at = from + at;
        if let Some(width) = shortcode_width(&slice[at..], emoji) {
            return Some((at, at + width));
        }
    }
    None
}

/// The byte length of a `:shortcode:` at the start of `rest`, if it is one and
/// it produces `emoji`.
///
/// Resolving the name through comrak's own table rather than accepting anything
/// shaped like `:word:` is what stops a literal `:00:` in prose from being
/// mistaken for the emoji that follows it.
fn shortcode_width(rest: &str, emoji: &str) -> Option<usize> {
    let body = rest.get(1..)?;
    let end = body.find(':')?;
    let name = body.get(..end)?;
    let resolved = comrak::nodes::NodeShortCode::resolve(name)?;
    (resolved.emoji == emoji).then_some(end + 2)
}

/// The characters an entity at the start of `rest` produces, and how many source
/// bytes it occupies.
///
/// Named entities come from the generated HTML5 table rather than a hand-written
/// list, because comrak decodes the whole of it: a document using `&hellip;`
/// would otherwise misplace every caret after it, silently. Some entities
/// produce two code points, which is why this returns a string.
fn decode_entity(rest: &str) -> Option<(String, usize)> {
    let end = rest.find(';')?;
    let body = rest.get(1..end)?;
    let width = end + 1;

    if let Some(digits) = body.strip_prefix("#x").or_else(|| body.strip_prefix("#X")) {
        let code = u32::from_str_radix(digits, 16).ok()?;
        return char::from_u32(code).map(|c| (c.to_string(), width));
    }
    if let Some(digits) = body.strip_prefix('#') {
        let code: u32 = digits.parse().ok()?;
        return char::from_u32(code).map(|c| (c.to_string(), width));
    }

    let spelling = &rest[..width];
    entities::ENTITIES
        .iter()
        .find(|entity| entity.entity == spelling)
        .map(|entity| (entity.characters.to_owned(), width))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KITCHEN_SINK: &str = include_str!("../../test/fixtures/kitchen-sink.md");

    fn map(source: &str) -> Vec<BlockMap> {
        build(source, RenderOptions::default())
    }

    /// Whether the source range a run claims really produces that run's text,
    /// and ends exactly where the run says it does.
    fn produces(source: &str, run: &TextRun, smart: bool) -> bool {
        if match_here(source, run.source_start, &run.text, smart) == Some(run.source_end) {
            return true;
        }
        // An emoji run is spelled `:name:` in the source, so it matches by
        // spelling rather than by character.
        shortcode_width(&source[run.source_start..], &run.text)
            == Some(run.source_end - run.source_start)
    }

    /// Every run must be a byte-exact slice of the source at the offset the map
    /// claims. This is the property the whole editing design rests on: if it
    /// holds, a caret position in the rendered view is a file position.
    #[test]
    fn runs_round_trip_to_their_source_offsets() {
        let blocks = map(KITCHEN_SINK);
        let mut wrong = Vec::new();

        for block in &blocks {
            for run in &block.runs {
                if !produces(KITCHEN_SINK, run, false) {
                    wrong.push(format!(
                        "line {} [{}]: {:?} is not what {}..{} produces",
                        block.line, block.kind, run.text, run.source_start, run.source_end
                    ));
                }
            }
        }

        assert!(
            wrong.is_empty(),
            "{} run(s) did not round-trip:\n{}",
            wrong.len(),
            wrong.join("\n")
        );
    }

    #[test]
    fn every_block_aligns_completely() {
        let blocks = map(KITCHEN_SINK);
        let failed: Vec<_> = blocks
            .iter()
            .filter_map(|b| match &b.alignment {
                Alignment::Failed(text) => Some(format!(
                    "line {} [{}]: {:?} not found",
                    b.line, b.kind, text
                )),
                Alignment::Exact => None,
            })
            .collect();

        assert!(
            failed.is_empty(),
            "{} block(s) failed to align:\n{}",
            failed.len(),
            failed.join("\n")
        );
    }

    /// Prints what the two tests above actually examined. A map that covered
    /// three paragraphs would pass them without proving anything.
    #[test]
    fn report_coverage() {
        let blocks = map(KITCHEN_SINK);
        let runs: usize = blocks.iter().map(|b| b.runs.len()).sum();
        let bytes: usize = blocks
            .iter()
            .flat_map(|b| &b.runs)
            .map(|r| r.text.len())
            .sum();
        eprintln!(
            "blocks={} runs={} mapped_bytes={} of {} source bytes",
            blocks.len(),
            runs,
            bytes,
            KITCHEN_SINK.len()
        );
        for kind in ["paragraph", "heading", "table-cell"] {
            eprintln!(
                "  {kind}: {}",
                blocks.iter().filter(|b| b.kind == kind).count()
            );
        }
        assert!(
            runs > 100,
            "only {runs} runs — the fixture is not exercising this"
        );
    }

    /// The cases I expected to break the forward scan: the rendered text is not
    /// a literal substring of the source at the point the scan is looking.
    #[test]
    fn adversarial_inline_constructs() {
        let cases = [
            ("escape", r"A \*not emphasis\* B"),
            ("entity", "Fish &amp; chips &lt;here&gt;"),
            // Beyond the handful anyone would write by hand.
            (
                "named entity",
                "An ellipsis &hellip; a dash &mdash; a space&nbsp;here",
            ),
            // `&nGg;` is a single entity producing two code points.
            ("two-codepoint entity", "Much greater &nGg; than"),
            ("numeric entity", "Decimal &#8212; and hex &#x2014; dashes"),
            // A literal `:00:` must not be mistaken for the emoji beside it.
            ("colon that is not a shortcode", "At :00: sharp :tada: yes"),
            ("autolink", "See https://example.com/a?b=1 now"),
            ("footnote", "Text with a ref[^1]\n\n[^1]: The note"),
            ("nested emphasis", "**bold with _inner_ text** after"),
            ("inline code", "Use `let x = 1;` in code"),
            ("link", "A [labelled link](http://e.com) here"),
            ("image", "An ![alt text](pic.png) inline"),
            ("wikilink", "A [[Design Notes]] link"),
            // The one that would catch a bad mapping: what the reader sees is the
            // title after the pipe, so a run claiming the whole `[[…]]` would let an
            // edit to "shown" rewrite the target instead.
            ("piped wikilink", "A [[Design Notes|shown]] link"),
            ("hard break", "Line one  \nLine two"),
            ("smart-ish punctuation", "It's a \"quoted\" word -- dash"),
            ("repeated word", "the the the the"),
            ("unicode", "café → naïve — 日本語 text"),
            ("html inline", "Press <kbd>Ctrl</kbd> now"),
            ("math", "Inline $x^2 + y$ math"),
            ("strikethrough", "~~gone~~ but here"),
            ("task list", "- [x] done\n- [ ] todo"),
        ];

        let mut broken = Vec::new();
        for (name, source) in cases {
            for block in map(source) {
                if let Alignment::Failed(text) = &block.alignment {
                    broken.push(format!("{name}: {text:?} not found in {source:?}"));
                }
                for run in &block.runs {
                    if !produces(source, run, false) {
                        broken.push(format!(
                            "{name}: {:?} is not what {}..{} produces",
                            run.text, run.source_start, run.source_end
                        ));
                    }
                }
            }
        }

        assert!(
            broken.is_empty(),
            "{} broken:\n{}",
            broken.len(),
            broken.join("\n")
        );
    }

    /// Smart punctuation is a setting (`RenderOptions::smart_punctuation`), and
    /// when it is on comrak rewrites the text: `--` renders as an en dash, `"`
    /// as a curly quote. That is a third way rendered text stops being a literal
    /// substring of the source, after escapes and entities — and unlike those it
    /// is invisible unless the reader happens to have the setting on.
    #[test]
    fn aligns_with_smart_punctuation_on() {
        let smart = RenderOptions {
            smart_punctuation: true,
        };
        let cases = [
            "An en -- dash and an em --- dash",
            "It's a \"quoted\" word and a 'single' one",
            "Trailing ellipsis... here",
        ];

        let mut broken = Vec::new();
        for source in cases {
            for block in build(source, smart) {
                if let Alignment::Failed(text) = &block.alignment {
                    broken.push(format!("{source:?}: {text:?} not found"));
                }
                for run in &block.runs {
                    if !produces(source, run, true) {
                        broken.push(format!(
                            "{source:?}: {:?} is not what {}..{} produces",
                            run.text, run.source_start, run.source_end
                        ));
                    }
                }
            }
        }

        assert!(
            broken.is_empty(),
            "{} broken:\n{}",
            broken.len(),
            broken.join("\n")
        );
    }

    /// Writes what this module thinks each block's caret-addressable text is, so
    /// it can be diffed against what the webview's DOM walk produces for the same
    /// block. Ignored by default — it is a tool for the DOM comparison, not an
    /// assertion. Run with `cargo test -- --ignored dump_block_text`.
    #[test]
    #[ignore = "writes a file for the DOM comparison; not an assertion"]
    fn dump_block_text() {
        let escape = |value: &str| {
            value
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
        };

        let entries: Vec<String> = map(KITCHEN_SINK)
            .iter()
            .map(|block| {
                let text: String = block.runs.iter().map(|run| run.text.as_str()).collect();
                format!(
                    "{{\"sourcepos\":\"{}\",\"kind\":\"{}\",\"text\":\"{}\"}}",
                    block.sourcepos,
                    block.kind,
                    escape(&text)
                )
            })
            .collect();

        let out = std::env::var("SRCMAP_DUMP").unwrap_or_else(|_| "srcmap-dump.json".to_owned());
        std::fs::write(&out, format!("[{}]", entries.join(","))).unwrap();
        eprintln!("wrote {} blocks to {out}", entries.len());
    }

    /// The webview indexes the source as a JavaScript string, so what it gets
    /// has to be UTF-16 offsets. Byte offsets would land in the wrong place in
    /// any document containing an accent, a dash, or an emoji.
    #[test]
    fn webview_offsets_are_utf16_not_bytes() {
        // "café" is 5 bytes and 4 UTF-16 units; the emoji is 4 bytes and 2 units.
        let source = "café 🎉 done\n";
        let blocks = for_webview(source, RenderOptions::default());
        let runs: Vec<&TextRun> = blocks.iter().flat_map(|b| &b.runs).collect();
        assert!(!runs.is_empty(), "expected the paragraph to map");

        let utf16: Vec<u16> = source.encode_utf16().collect();
        for run in runs {
            let slice = String::from_utf16(&utf16[run.source_start..run.source_end]).unwrap();
            assert_eq!(
                slice, run.text,
                "the run's text must be what those UTF-16 offsets select"
            );
        }
    }

    /// A block that could not be fully located must not reach the webview at
    /// all: editing through a wrong offset corrupts a file rather than merely
    /// misplacing a caret.
    #[test]
    fn webview_never_sees_a_block_that_did_not_align() {
        for block in for_webview(KITCHEN_SINK, RenderOptions::default()) {
            assert!(block.is_aligned, "line {} leaked", block.line);
            assert!(!block.runs.is_empty(), "line {} has no runs", block.line);
        }
    }

    /// Guards the spike itself: a fixture that stopped covering the hard
    /// constructs would make the two tests above pass for the wrong reason.
    #[test]
    fn fixture_still_exercises_the_hard_cases() {
        assert!(KITCHEN_SINK.contains("```"), "no fenced code");
        assert!(KITCHEN_SINK.contains("- ["), "no task list");
        assert!(KITCHEN_SINK.contains('|'), "no table");
    }
}
