//! Making MDX legible without executing any of it.
//!
//! MDX is Markdown with JSX in it. lindo-md cannot run the JSX — a document is
//! arbitrary input from an arbitrary file, and JSX is arbitrary JavaScript — so the
//! honest rendering is to *show* the components rather than to evaluate them. What is
//! not honest is what happens without this module: comrak runs with `unsafe_` on, so
//! `<Callout type="warn">Back up first</Callout>` reaches ammonia as raw HTML, ammonia
//! strips the element it does not recognise and keeps the children, and the reader
//! ends up with a bare paragraph reading `Back up first` — no callout, no code, no
//! indication that anything was removed at all. Silent, and wrong in the direction
//! that loses information.
//!
//! So: fence the JSX before comrak sees it, and it renders as a visible `jsx` block.
//!
//! **This is a heuristic, not an MDX parser, and it fails toward doing nothing.** The
//! cost of missing a block is cosmetic — it renders as it does today. The cost of
//! fencing something that was not JSX is a document that used to render and now shows
//! its own markup, so every rule below is written to be narrow:
//!
//! - column 0 only, so `a < b` and inline `<kbd>` mid-sentence are invisible to it;
//! - the tag must start with an uppercase letter or be a fragment, which is precisely
//!   MDX's own component/element distinction — every raw-HTML construct this app
//!   renders (`<details>`, `<summary>`, `<kbd>`, `<sub>`, `<div>`) is lowercase and
//!   passes through untouched;
//! - existing fenced and indented code is tracked and never rewritten;
//! - anything unterminated is left exactly as it was found.
//!
//! MDX `{expression}` blocks are deliberately *not* handled. A line starting `{` at
//! column 0 turns up in JSON samples often enough that the payoff does not cover the
//! risk of eating one.
//!
//! Because this shifts line numbers, an MDX document is read-only — see
//! `files::MDX_EXTENSIONS`, which explains why in full.

/// Rewrites the JSX and ESM blocks of an MDX document as fenced `jsx` code.
pub fn prepass(source: &str) -> String {
    let lines: Vec<&str> = source.split_inclusive('\n').collect();
    let mut out = String::with_capacity(source.len() + 64);
    let mut index = 0;
    // The delimiter of the fence we are currently inside, if any. Kept as the literal
    // run so that a ```` ``` ```` inside a ```` ```` ```` block does not close it.
    let mut open_fence: Option<String> = None;
    // Whether the previous non-blank output line ended a block. A JSX or import run is
    // only recognised at the start of a block, which is what keeps `x <Foo` in the
    // middle of a paragraph from matching.
    let mut at_block_start = true;

    while let Some(line) = lines.get(index).copied() {
        if let Some(fence) = open_fence.clone() {
            out.push_str(line);
            if closes_fence(line, &fence) {
                open_fence = None;
            }
            index += 1;
            at_block_start = false;
            continue;
        }

        if let Some(fence) = opens_fence(line) {
            out.push_str(line);
            open_fence = Some(fence);
            index += 1;
            at_block_start = false;
            continue;
        }

        // An indented code block is code the author already asked for.
        if is_indented_code(line) {
            out.push_str(line);
            index += 1;
            at_block_start = false;
            continue;
        }

        if line.trim().is_empty() {
            out.push_str(line);
            index += 1;
            at_block_start = true;
            continue;
        }

        if at_block_start && starts_capture(line) {
            let end = capture_end(&lines, index);
            let captured: String = lines.get(index..end).unwrap_or_default().concat();
            out.push_str(&fenced(&captured));
            index = end;
            at_block_start = true;
            continue;
        }

        out.push_str(line);
        index += 1;
        at_block_start = false;
    }

    out
}

/// A line that begins a run we want to fence: a top-level ESM statement, or a
/// block-level JSX element.
fn starts_capture(line: &str) -> bool {
    is_esm(line) || is_jsx(line)
}

/// `import …` / `export …` at column 0. MDX only allows these at the top level, so
/// there is no indented form to worry about.
fn is_esm(line: &str) -> bool {
    ["import", "export"].iter().any(|keyword| {
        line.strip_prefix(keyword)
            .is_some_and(|rest| rest.starts_with([' ', '\t', '{', '*']))
    })
}

/// `<Foo`, `</Foo`, `<Foo.Bar` or a `<>` fragment at column 0.
///
/// The uppercase test is the whole discriminator between a component and the ordinary
/// inline HTML this app has always rendered, and it is MDX's own rule rather than one
/// invented here.
fn is_jsx(line: &str) -> bool {
    let rest = match line.strip_prefix("</") {
        Some(rest) => rest,
        None => match line.strip_prefix('<') {
            Some(rest) => rest,
            None => return false,
        },
    };
    rest.starts_with('>') || rest.starts_with(|c: char| c.is_ascii_uppercase())
}

/// A captured run ends at the next blank line, or at the end of the file.
///
/// Blank-line termination rather than tag matching is deliberate: counting `<` and `>`
/// across a document means being wrong about strings, comments and generics, and being
/// wrong there swallows prose. MDX authors separate blocks with blank lines anyway.
fn capture_end(lines: &[&str], start: usize) -> usize {
    let mut end = start + 1;
    while lines.get(end).is_some_and(|line| !line.trim().is_empty()) {
        end += 1;
    }
    end
}

/// Wraps a captured run in a `jsx` fence long enough to contain it.
///
/// The length matters and is not cosmetic. Fence with three backticks around a block
/// that itself contains a ``` line and the document closes our fence early — after
/// which the rest of the JSX reaches comrak as raw HTML, with `unsafe_` on, which is
/// the exact outcome this module exists to prevent. CommonMark lets the opening fence
/// be any run of three or more, and closes it only on a run at least as long, so one
/// longer than anything inside is always enough.
fn fenced(captured: &str) -> String {
    let ticks = "`".repeat(longest_backtick_run(captured).max(2) + 1);
    let body = captured.strip_suffix('\n').unwrap_or(captured);
    format!("{ticks}jsx\n{body}\n{ticks}\n\n")
}

fn longest_backtick_run(text: &str) -> usize {
    let mut longest = 0;
    let mut current = 0;
    for ch in text.chars() {
        if ch == '`' {
            current += 1;
            longest = longest.max(current);
        } else {
            current = 0;
        }
    }
    longest
}

/// The delimiter run if this line opens a fence — ``` or ~~~, three or more.
fn opens_fence(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    // More than three spaces of indent makes it indented code, not a fence.
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    for marker in ['`', '~'] {
        let run: String = trimmed.chars().take_while(|c| *c == marker).collect();
        if run.len() >= 3 {
            return Some(run);
        }
    }
    None
}

/// A closing fence is a run of the same character, at least as long as the opener, and
/// nothing else on the line.
fn closes_fence(line: &str, fence: &str) -> bool {
    let trimmed = line.trim();
    let Some(marker) = fence.chars().next() else {
        return false;
    };
    !trimmed.is_empty() && trimmed.len() >= fence.len() && trimmed.chars().all(|c| c == marker)
}

fn is_indented_code(line: &str) -> bool {
    line.starts_with("    ") || line.starts_with('\t')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_import_block_becomes_a_fence() {
        let out = prepass("import { Callout } from \"./x\"\n\ntext\n");
        assert!(out.contains("```jsx\nimport { Callout } from \"./x\"\n```"));
        assert!(out.contains("text"));
    }

    #[test]
    fn an_export_block_becomes_a_fence() {
        let out = prepass("export const meta = { title: \"x\" }\n\ntext\n");
        assert!(out.starts_with("```jsx\nexport const meta"), "got {out}");
    }

    #[test]
    fn a_component_block_becomes_a_fence() {
        let out = prepass("<Callout type=\"warn\">\n  Back up first\n</Callout>\n\ntext\n");
        assert!(out.contains("```jsx\n<Callout type=\"warn\">"), "got {out}");
        assert!(out.contains("Back up first"));
        assert!(out.contains("text"));
    }

    #[test]
    fn a_fragment_and_a_member_expression_are_both_jsx() {
        assert!(prepass("<>\nx\n</>\n").contains("```jsx"));
        assert!(prepass("<Foo.Bar />\n").contains("```jsx"));
    }

    /// The constructs `markdown.rs` deliberately keeps working must be untouched, or
    /// this feature breaks documents that render today.
    #[test]
    fn lowercase_html_is_left_exactly_as_it_was() {
        for source in [
            "<details>\n<summary>More</summary>\nbody\n</details>\n",
            "<div align=\"center\">\nx\n</div>\n",
            "<kbd>Ctrl</kbd>\n",
            "<img src=\"a.png\">\n",
        ] {
            assert_eq!(prepass(source), source, "{source:?}");
        }
    }

    #[test]
    fn ordinary_prose_containing_angle_brackets_is_untouched() {
        for source in [
            "a < b and c > d\n",
            "See <https://example.com> for more.\n",
            "The value is 1 <2 in that case.\n",
            "Press <kbd>x</kbd> to continue.\n",
            "text mentioning <Foo /> mid-sentence\n",
        ] {
            assert_eq!(prepass(source), source, "{source:?}");
        }
    }

    #[test]
    fn content_inside_an_existing_fence_is_untouched() {
        let source = "```jsx\n<Callout>x</Callout>\nimport y from \"z\"\n```\n";
        assert_eq!(prepass(source), source);
    }

    #[test]
    fn a_tilde_fence_is_honoured_too() {
        let source = "~~~\n<Callout>x</Callout>\n~~~\n";
        assert_eq!(prepass(source), source);
    }

    #[test]
    fn indented_code_is_untouched() {
        let source = "    <Callout>x</Callout>\n";
        assert_eq!(prepass(source), source);
    }

    /// The security-relevant one. A JSX block containing a ``` line must not be able
    /// to close the fence we put around it — if it could, the rest would reach comrak
    /// as raw HTML with `unsafe_` on.
    #[test]
    fn a_block_containing_a_fence_gets_a_longer_fence() {
        let source = "<Callout>\n```\nnot the end\n```\n</Callout>\n";
        let out = prepass(source);
        assert!(out.starts_with("````jsx\n"), "got {out}");
        assert!(out.contains("\n````\n"), "and closes with four: {out}");
        // The inner three-tick lines are still there, inert.
        assert!(out.contains("not the end"));
    }

    #[test]
    fn the_fence_grows_past_whatever_the_block_contains() {
        let source = "<Callout>\n``````\nx\n</Callout>\n";
        let out = prepass(source);
        assert!(out.starts_with("```````jsx\n"), "got {out}");
    }

    /// End to end: whatever the pre-pass emits, nothing executable may survive the
    /// render. This is the assertion that actually matters — the fence length is the
    /// mechanism, this is the property.
    ///
    /// Note what is *not* asserted: that `onClick=` is absent from the output. It is
    /// present, escaped, inside a `<code>` block — which is the feature working. Text
    /// that reads like an attack but cannot execute is exactly what showing the source
    /// of a component means, and `markdown.rs`'s own corpus test makes the same
    /// distinction by inspecting only what sits inside a tag.
    #[test]
    fn no_component_reaches_the_rendered_html_as_markup() {
        use crate::markdown::{render_with, RenderOptions};

        for source in [
            "<Callout onClick=\"alert(1)\">x</Callout>\n",
            "<Callout>\n```\n</Callout>\n<script>alert(1)</script>\n```\n</Callout>\n",
            "import x from \"y\"\n\n<Foo bar={() => alert(1)} />\n",
        ] {
            let html = render_with(&prepass(source), RenderOptions::default()).html;
            for opening in ["<Callout", "<Foo", "<script", "<iframe"] {
                assert!(
                    !html.contains(opening),
                    "{opening} survived as markup: {html}"
                );
            }
            // And the text is still there to read, rather than having been swallowed —
            // the silent-stripping bug this module exists to fix.
            assert!(
                html.contains("&lt;Callout") || html.contains("&lt;Foo") || html.contains("import"),
                "the component vanished instead of being shown: {html}"
            );
        }
    }

    #[test]
    fn a_document_with_no_jsx_is_returned_unchanged() {
        let source = "# Title\n\nSome *text* and a [link](x).\n\n- a\n- b\n";
        assert_eq!(prepass(source), source);
    }

    #[test]
    fn an_empty_document_does_not_panic() {
        assert_eq!(prepass(""), "");
    }

    /// The whole fixture, end to end, because the individual rules above can each be
    /// right while their interaction is not — a fence-escape block sitting after four
    /// captured runs is a different test from one on its own.
    #[test]
    fn the_fixture_renders_with_nothing_executable_and_nothing_swallowed() {
        use crate::markdown::{render_with, RenderOptions};

        const FIXTURE: &str = include_str!("../../test/fixtures/mdx-sink.mdx");
        let html = render_with(&prepass(FIXTURE), RenderOptions::default()).html;

        for opening in [
            "<Callout", "<Chart", "<Foo", "<script", "onerror=", "onclick=",
        ] {
            assert!(!html.contains(opening), "{opening} survived: {html}");
        }

        // The components are visible as code rather than quietly dropped.
        assert!(html.contains("&lt;Callout"), "the callout was swallowed");
        assert!(html.contains("import"), "the import block was swallowed");

        // Lowercase HTML still renders as HTML — the thing that must not regress.
        assert!(html.contains("<details"), "details stopped rendering");
        assert!(html.contains("<kbd"), "kbd stopped rendering");

        // Ordinary Markdown around it is untouched.
        assert!(html.contains("<h1"), "the heading stopped rendering");
        // `<em` rather than `<em>`: sourcepos is on, so every element carries
        // attributes and the bare closing bracket never appears.
        assert!(html.contains("<em"), "emphasis stopped rendering");
    }

    /// A plain Markdown document must come through the pre-pass byte for byte. If this
    /// ever fails, every `.md` in the app is at risk, not just MDX.
    #[test]
    fn the_markdown_kitchen_sink_is_returned_unchanged() {
        const KITCHEN_SINK: &str = include_str!("../../test/fixtures/kitchen-sink.md");
        assert_eq!(prepass(KITCHEN_SINK), KITCHEN_SINK);
    }

    #[test]
    fn a_run_at_end_of_file_without_a_trailing_blank_line_still_closes() {
        let out = prepass("<Callout>\nx\n</Callout>");
        assert!(out.contains("```jsx\n<Callout>"), "got {out}");
        assert!(out.trim_end().ends_with("```"), "got {out}");
    }
}
