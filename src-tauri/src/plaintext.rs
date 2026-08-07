//! Rendering a text file as itself.
//!
//! This is the one document path that never reaches comrak, and that is the entire
//! point of it. A `.txt` holding `# TODO` has to show a hash and a space; a `.log`
//! full of `*` and `_` has to keep them. Running these through a Markdown parser
//! would not merely restyle them, it would *rewrite what the file says* — and since
//! the rendered view is editable in this app, a reader could then save that reading
//! back over the original.
//!
//! Because nothing here parses, nothing here can be tricked into emitting markup:
//! the source is escaped in full and wrapped in a single `<pre>`. That makes this
//! module's safety argument a one-liner, unlike `markdown.rs`, which needs comrak
//! with `unsafe_` on and ammonia afterwards. The tests hold it to hostile input
//! regardless, because "it cannot emit a tag" is a claim worth checking rather than
//! asserting.

use crate::markdown::escape_html;

/// The rendered body for a plain-text document.
///
/// `mono` picks the face. It is a parameter rather than something the stylesheet
/// works out from an extension, so the decision stays beside the other extension
/// questions in `files` instead of being split across two languages.
pub fn render(source: &str, mono: bool) -> String {
    let class = if mono {
        "plain-text plain-text--mono"
    } else {
        "plain-text"
    };
    format!("<pre class=\"{class}\">{}</pre>", escape_html(source))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(source: &str) -> String {
        render(source, false)
    }

    /// The reason this module exists. Every one of these is a construct comrak would
    /// have consumed.
    #[test]
    fn markdown_syntax_survives_as_literal_characters() {
        for source in [
            "# TODO",
            "*note*",
            "_emphasis_",
            "- [ ] a task",
            "| a | b |",
            "> quoted",
            "```rust",
            "[link](https://example.com)",
            "---",
            "$$x^2$$",
            "[^1]: a footnote",
        ] {
            let out = body(source);
            // Compared against the escaped form, not the raw one: `> quoted` reaches
            // the page as `&gt; quoted`, which *is* the character surviving. What
            // would fail here is comrak turning it into a `<blockquote>`.
            assert!(
                out.contains(&escape_html(source)),
                "{source:?} should survive verbatim, got {out}"
            );
        }
    }

    /// A `.txt` opening with `---` must not have its first paragraph eaten as
    /// frontmatter, which is what `render_with` would do to it.
    #[test]
    fn a_leading_triple_dash_is_not_frontmatter() {
        let out = body("---\ntitle: not really\n---\nbody");
        assert!(out.contains("title: not really"), "got {out}");
        assert!(out.contains("body"));
    }

    #[test]
    fn the_wrapping_pre_is_the_only_tag_in_the_output() {
        let out = body("<b>x</b> & <i>y</i> \"q\" 'a'");
        // Every `<` from the source is escaped, so the only two left are ours.
        assert_eq!(out.matches('<').count(), 2, "got {out}");
        assert!(out.starts_with("<pre class=\"plain-text\">"));
        assert!(out.ends_with("</pre>"));
    }

    /// The same shape as `markdown.rs`'s property test: rather than listing what must
    /// not appear, assert that nothing outside our own `<pre>` is a tag at all.
    #[test]
    fn no_hostile_document_can_emit_markup() {
        const HOSTILE: [&str; 10] = [
            "<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
            "<a href=\"javascript:alert(1)\">x</a>",
            "<iframe src=\"data:text/html,<script>alert(1)</script>\"></iframe>",
            "<svg><animate onbegin=alert(1) attributeName=x dur=1s>",
            "<style>@import 'http://evil'</style>",
            "<body onbeforetoggle=alert(1)>",
            "</pre><script>alert(1)</script><pre>",
            "<pre class=\"plain-text\">x</pre>",
            "<!--<script>alert(1)</script>-->",
        ];

        for source in HOSTILE {
            let out = body(source);
            let inner = out
                .strip_prefix("<pre class=\"plain-text\">")
                .and_then(|rest| rest.strip_suffix("</pre>"))
                .unwrap_or_else(|| panic!("wrapper missing for {source:?}: {out}"));
            assert!(
                !inner.contains('<') && !inner.contains('>'),
                "{source:?} left angle brackets in the body: {inner}"
            );
        }
    }

    /// The vector worth naming on its own: a document that tries to close our wrapper
    /// and continue outside it. Escaping the `/` is not what stops this — escaping the
    /// `<` is — so the assertion is on the count, not on the absence of `</pre`.
    #[test]
    fn a_document_cannot_close_the_wrapper_it_is_inside() {
        let out = body("</pre><script>alert(1)</script>");
        assert_eq!(out.matches("</pre>").count(), 1, "got {out}");
        assert!(!out.contains("<script"), "got {out}");
    }

    #[test]
    fn whitespace_that_carries_meaning_is_preserved() {
        let source = "col1\tcol2\n  indented\ntrailing   \n\n\nafter blanks";
        let out = body(source);
        assert!(out.contains('\t'), "tabs are how a log lines up");
        assert!(out.contains("  indented"));
        assert!(out.contains("trailing   "));
        assert!(out.contains("\n\n\n"), "blank runs are not collapsed");
    }

    #[test]
    fn carriage_returns_survive() {
        let out = body("windows\r\nline\r\nendings");
        assert_eq!(out.matches('\r').count(), 2, "got {out:?}");
    }

    #[test]
    fn an_empty_file_renders_an_empty_block() {
        assert_eq!(body(""), "<pre class=\"plain-text\"></pre>");
    }

    #[test]
    fn the_mono_variant_only_adds_a_class() {
        assert!(render("x", false).contains("class=\"plain-text\">"));
        assert!(render("x", true).contains("class=\"plain-text plain-text--mono\">"));
    }

    /// The editing path keys off `data-sourcepos`, so its absence here is one reason a
    /// plain-text document is inert in the webview. It is not *the* reason: `files::save`
    /// refusing the write is what actually enforces read-only.
    #[test]
    fn nothing_in_the_output_carries_a_sourcepos() {
        let out = body("# TODO\n\nsome text\n\n- a list");
        assert!(!out.contains("data-sourcepos"), "got {out}");
    }
}
