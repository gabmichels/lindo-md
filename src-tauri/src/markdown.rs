//! Markdown → sanitized HTML, plus the table of contents.
//!
//! comrak renders with `unsafe_` enabled so that the raw HTML GitHub supports —
//! `<details>`, `<kbd>`, `<img align>`, `<sub>` — survives instead of being
//! escaped into visible angle brackets. That makes the ammonia pass afterwards
//! **mandatory**: a `.md` file is arbitrary untrusted input, and without it a
//! document could ship a `<script>` into the webview. Never remove the sanitize
//! step to "fix" a stripped tag — widen the allowlist in `sanitizer()` instead.
//!
//! Code and Mermaid fences are rewritten into a shape the frontend can enhance
//! lazily (`src/lib/render/`): highlighting and diagram rendering happen in the
//! webview, where the real VS Code grammars and Mermaid live.

use std::cell::RefCell;

use comrak::nodes::{AstNode, NodeValue};
use comrak::{Anchorizer, Arena, Options};
use serde::Serialize;

/// One entry of the document outline. `id` matches the anchor comrak generated
/// for the same heading, because both sides run the same `Anchorizer` over the
/// same headings in the same order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedDoc {
    pub html: String,
    pub toc: Vec<Heading>,
    /// Raw YAML frontmatter with its `---` fences removed, if the document had any.
    pub frontmatter: Option<String>,
    /// The first level-1 heading, when there is one. The caller falls back to the
    /// file name — this module does not know about files.
    pub title: Option<String>,
}

/// The rendering choices a reader can change. Separate from `Options` so the
/// settings that reach here stay an explicit, small list rather than exposing all
/// of comrak's surface to the frontend.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RenderOptions {
    /// Straight quotes become curly, `--` becomes an en dash, `...` an ellipsis.
    /// Off by default: it is a change to the author's text, and prose that
    /// discusses code suffers most from having its quotes rewritten.
    pub smart_punctuation: bool,
}

/// Visible to `srcmap`, which must parse with exactly the options the document
/// was rendered with — a map built under different rules describes a document
/// the reader is not looking at.
pub(crate) fn options(settings: RenderOptions) -> Options<'static> {
    let mut options = Options::default();
    options.parse.smart = settings.smart_punctuation;

    let ext = &mut options.extension;
    ext.table = true;
    ext.strikethrough = true;
    ext.tasklist = true;
    ext.autolink = true;
    ext.footnotes = true;
    ext.description_lists = true;
    ext.superscript = true;
    ext.subscript = true;
    ext.multiline_block_quotes = true;
    ext.alerts = true;
    ext.math_dollars = true;
    ext.math_code = true;
    ext.shortcodes = true;
    ext.front_matter_delimiter = Some("---".to_owned());
    // An empty prefix keeps ids identical to the text anchor a reader would type
    // by hand (`#installation`), which is what relative `file.md#anchor` links in
    // real repositories point at. GitHub's `user-content-` prefix exists to avoid
    // colliding with its own page markup; we have no such markup.
    ext.header_ids = Some(String::new());

    let render = &mut options.render;
    // See the module doc: this is why sanitize() is not optional.
    render.unsafe_ = true;
    render.github_pre_lang = true;
    // Puts `task-list-item` on the <li>, so the checkbox can be styled without a
    // fragile `:has(input)` selector.
    render.tasklist_classes = true;
    // Every block element carries the line range it came from, which is what lets
    // an edit made in the rendered view be applied to the file. See `srcmap.rs`.
    render.sourcepos = true;

    options
}

pub fn render_with(source: &str, settings: RenderOptions) -> RenderedDoc {
    let arena = Arena::new();
    let options = options(settings);
    let root = comrak::parse_document(&arena, source, &options);

    let frontmatter = take_frontmatter(root);
    let toc = collect_toc(root);
    let title = toc.iter().find(|h| h.level == 1).map(|h| h.text.clone());

    // Before `rewrite_code_blocks`, which legitimately writes `data-sourcepos` into
    // `HtmlBlock` literals of its own making.
    strip_forged_sourcepos(root);
    rewrite_code_blocks(&arena, root);

    let mut html = String::new();
    // Infallible: the sink is a `String`, whose `io::Write` impl never returns Err.
    #[allow(clippy::expect_used, reason = "writing to a String cannot fail")]
    {
        comrak::format_html(root, &options, &mut html).expect("writing to a String cannot fail");
    }

    RenderedDoc {
        html: sanitizer().clean(&html).to_string(),
        toc,
        frontmatter,
        title,
    }
}

/// Removes the frontmatter node and returns its body. comrak keeps the literal
/// including the `---` fences and the trailing newline.
fn take_frontmatter<'a>(root: &'a AstNode<'a>) -> Option<String> {
    let node = root
        .children()
        .find(|n| matches!(n.data.borrow().value, NodeValue::FrontMatter(_)))?;

    let literal = match &node.data.borrow().value {
        NodeValue::FrontMatter(text) => text.clone(),
        _ => unreachable!("filtered above"),
    };
    node.detach();

    let body = literal
        .trim()
        .trim_start_matches("---")
        .trim_end_matches("---")
        .trim_matches('\n');
    Some(body.to_owned())
}

fn collect_toc<'a>(root: &'a AstNode<'a>) -> Vec<Heading> {
    let anchorizer = RefCell::new(Anchorizer::new());
    let mut toc = Vec::new();

    for node in root.descendants() {
        let level = match node.data.borrow().value {
            NodeValue::Heading(heading) => heading.level,
            _ => continue,
        };
        let text = text_content(node);
        if text.is_empty() {
            continue;
        }
        let id = anchorizer.borrow_mut().anchorize(&text);
        toc.push(Heading { level, text, id });
    }

    toc
}

/// The plain-text content of a node, used for heading titles and anchors.
/// Mirrors what comrak feeds its own anchorizer, so the two agree.
fn text_content<'a>(node: &'a AstNode<'a>) -> String {
    let mut out = String::new();
    for descendant in node.descendants() {
        match &descendant.data.borrow().value {
            NodeValue::Text(text) => out.push_str(text),
            NodeValue::Code(code) => out.push_str(&code.literal),
            NodeValue::SoftBreak | NodeValue::LineBreak => out.push(' '),
            _ => {}
        }
    }
    out.trim().to_owned()
}

/// Removes any `data-sourcepos` a *document* wrote, as opposed to one comrak emitted.
///
/// `data-sourcepos` is the trust anchor of the editing path. The frontend reads it off
/// whatever element the caret is in to decide which run of the file an edit rewrites
/// (`lib/edit/selection.ts`) and which line a task checkbox toggles
/// (`lib/edit/tasks.ts`); neither cross-checks the element's text against the range,
/// and an out-of-range offset clamps rather than refusing, so it fails open.
///
/// comrak renders with `unsafe_` on, so a raw HTML block passes through verbatim, and
/// an attribute the document's author typed is byte-identical to one comrak generated.
/// ammonia cannot separate them either — it allows `data-sourcepos` generically. A
/// `<p data-sourcepos="1:1-1:15">DECOY</p>` beside a real paragraph therefore gave two
/// elements one identity, and bolding the decoy rewrote the real paragraph instead.
///
/// Stripping on the AST rather than over the finished HTML is what makes this safe:
/// only `HtmlBlock` and `HtmlInline` hold author-controlled markup, so the scan never
/// sees — and so cannot damage — the attributes comrak is about to write itself.
fn strip_forged_sourcepos<'a>(root: &'a AstNode<'a>) {
    for node in root.descendants() {
        let mut data = node.data.borrow_mut();
        match &mut data.value {
            NodeValue::HtmlBlock(block) => block.literal = without_sourcepos_attrs(&block.literal),
            NodeValue::HtmlInline(literal) => *literal = without_sourcepos_attrs(literal),
            _ => {}
        }
    }
}

/// Deletes every `data-sourcepos[=value]` sitting where an attribute can sit.
///
/// Scans bytes instead of lowercasing first, because `str::to_lowercase` is Unicode
/// aware and can change a string's byte length — which would misalign every index
/// after it. The needle is ASCII and a UTF-8 continuation byte can never equal an
/// ASCII one, so byte matching is both correct and safe to slice at.
fn without_sourcepos_attrs(literal: &str) -> String {
    const NEEDLE: &[u8] = b"data-sourcepos";
    let bytes = literal.as_bytes();
    let mut out = String::with_capacity(literal.len());
    // Everything before `copied` has already been written out.
    let mut copied = 0;
    let mut i = 0;

    while i < bytes.len() {
        // Only an occurrence preceded by whitespace can be an attribute. The same text
        // in a code sample or a text node is left alone.
        let is_attribute = bytes
            .get(i.wrapping_sub(1))
            .is_some_and(u8::is_ascii_whitespace)
            && i > 0
            && bytes
                .get(i..i.saturating_add(NEEDLE.len()))
                .is_some_and(|window| window.eq_ignore_ascii_case(NEEDLE));
        if !is_attribute {
            i = i.saturating_add(1);
            continue;
        }

        if let Some(chunk) = literal.get(copied..i) {
            out.push_str(chunk);
        }

        let mut j = i.saturating_add(NEEDLE.len());
        while bytes.get(j).is_some_and(u8::is_ascii_whitespace) {
            j = j.saturating_add(1);
        }
        if bytes.get(j) == Some(&b'=') {
            j = j.saturating_add(1);
            while bytes.get(j).is_some_and(u8::is_ascii_whitespace) {
                j = j.saturating_add(1);
            }
            match bytes.get(j) {
                Some(&quote) if quote == b'"' || quote == b'\'' => {
                    j = j.saturating_add(1);
                    while bytes.get(j).is_some_and(|b| *b != quote) {
                        j = j.saturating_add(1);
                    }
                    j = j.saturating_add(1).min(bytes.len());
                }
                // Unquoted values run to the next whitespace or the end of the tag.
                _ => {
                    while bytes
                        .get(j)
                        .is_some_and(|b| !b.is_ascii_whitespace() && *b != b'>')
                    {
                        j = j.saturating_add(1);
                    }
                }
            }
        }
        copied = j;
        i = j;
    }

    if let Some(rest) = literal.get(copied..) {
        out.push_str(rest);
    }
    out
}

/// Replaces every fenced block with markup the frontend can pick up:
///
/// - ```` ```mermaid ```` becomes `<pre class="mermaid-src">`, rendered to SVG in
///   the webview, where Mermaid actually lives.
/// - every other fence keeps comrak's `language-*` class (Shiki reads it) and
///   gains `data-lang` plus, if the info string carried one, `data-title` for the
///   filename header — comrak drops everything after the first word.
fn rewrite_code_blocks<'a>(arena: &'a Arena<AstNode<'a>>, root: &'a AstNode<'a>) {
    let blocks: Vec<_> = root
        .descendants()
        .filter(|n| matches!(n.data.borrow().value, NodeValue::CodeBlock(_)))
        .collect();

    for node in blocks {
        let (info, literal) = match &node.data.borrow().value {
            NodeValue::CodeBlock(block) => (block.info.clone(), block.literal.clone()),
            _ => unreachable!("filtered above"),
        };

        let lang = info.split_whitespace().next().unwrap_or("").to_lowercase();
        let escaped = escape_html(&literal);

        // Written into the literal rather than set on the replacement node:
        // comrak emits an `HtmlBlock` verbatim and never decorates it, so a
        // sourcepos stored on the node would never reach the HTML. A fence is an
        // atom — the rendered view cannot edit it — which makes this the only way
        // the source view can be told where to jump.
        let pos = node.data.borrow().sourcepos;
        let sourcepos = format!(
            " data-sourcepos=\"{}:{}-{}:{}\"",
            pos.start.line, pos.start.column, pos.end.line, pos.end.column
        );

        let html = if lang == "mermaid" {
            format!("<pre class=\"mermaid-src\"{sourcepos}>{escaped}</pre>")
        } else {
            let title = title_from_info(&info);
            let lang_attr = if lang.is_empty() {
                String::new()
            } else {
                format!(" data-lang=\"{}\"", escape_html(&lang))
            };
            let title_attr = match &title {
                Some(t) => format!(" data-title=\"{}\"", escape_html(t)),
                None => String::new(),
            };
            let code_class = if lang.is_empty() {
                String::new()
            } else {
                format!(" class=\"language-{}\"", escape_html(&lang))
            };
            format!(
                "<pre class=\"code-block\"{sourcepos}{lang_attr}{title_attr}><code{code_class}>{escaped}</code></pre>"
            )
        };

        let replacement = arena.alloc(AstNode::from(NodeValue::HtmlBlock(
            comrak::nodes::NodeHtmlBlock {
                block_type: 6,
                literal: html,
            },
        )));
        node.insert_before(replacement);
        node.detach();
    }
}

/// Pulls a filename out of a fence info string: ```` ```ts title="main.ts" ````
/// or the shorthand ```` ```ts:main.ts ````, both of which appear in the wild.
fn title_from_info(info: &str) -> Option<String> {
    let mut words = info.split_whitespace();
    let first = words.next()?;

    if let Some((_, name)) = first.split_once(':') {
        if !name.is_empty() {
            return Some(name.to_owned());
        }
    }

    for word in words {
        if let Some(rest) = word.strip_prefix("title=") {
            let name = rest.trim_matches(['"', '\'']);
            if !name.is_empty() {
                return Some(name.to_owned());
            }
        }
    }
    None
}

fn escape_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

/// The allowlist. Deliberately built from ammonia's defaults plus exactly what
/// GitHub-flavored Markdown needs — widen it here, never by weakening the call
/// site. `style` is not allowed anywhere: it is the one attribute that can move
/// content off-screen or over the chrome.
fn sanitizer() -> ammonia::Builder<'static> {
    let mut builder = ammonia::Builder::default();

    builder
        // `input` carries task-list checkboxes; `section` wraps the footnote list.
        .add_tags(["input", "section"])
        // `data-sourcepos` is comrak's line range for the element. The webview
        // needs it to map a caret back into the file; `export.rs` strips it so it
        // never reaches a standalone HTML file.
        .add_generic_attributes(["id", "class", "data-sourcepos"])
        .add_tag_attributes("a", ["href", "title", "aria-hidden"])
        .add_tag_attributes("img", ["src", "alt", "title", "align", "width", "height"])
        // `disabled` is deliberately absent, so ammonia strips the attribute
        // comrak puts on every task-list checkbox. Ticking a box is the one edit
        // a reader can make without a caret, and a disabled input cannot be
        // clicked at all.
        .add_tag_attributes("input", ["type", "checked"])
        .add_tag_attributes("th", ["align"])
        .add_tag_attributes("td", ["align"])
        .add_tag_attributes("ol", ["start"])
        .add_tag_attributes("pre", ["data-lang", "data-title"])
        // comrak marks up math with this attribute; KaTeX in the webview reads it.
        .add_tag_attributes("span", ["data-math-style"])
        .add_tag_attributes("section", ["data-footnotes"])
        // Only navigable schemes. `javascript:` and `data:text/html` are the two
        // that turn a link into script execution.
        .url_schemes(["http", "https", "mailto"].into_iter().collect())
        // Relative links are the point of a local viewer: `./other.md`, `img/a.png`.
        // The frontend resolves them against the document's directory.
        .url_relative(ammonia::UrlRelative::PassThrough)
        // Links are intercepted in the webview and handed to the OS browser, so a
        // rel attribute would be decoration; leaving it off keeps exported HTML clean.
        .link_rel(None);

    builder
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The defaults every test but the smart-punctuation one renders under.
    fn render(source: &str) -> RenderedDoc {
        render_with(source, RenderOptions::default())
    }

    fn html(source: &str) -> String {
        render(source).html
    }

    // --- GitHub-flavored constructs ---------------------------------------

    #[test]
    fn renders_headings_with_anchors_matching_the_toc() {
        let doc = render("# Getting Started\n\n## Install It\n");
        assert_eq!(
            doc.toc,
            vec![
                Heading {
                    level: 1,
                    text: "Getting Started".into(),
                    id: "getting-started".into()
                },
                Heading {
                    level: 2,
                    text: "Install It".into(),
                    id: "install-it".into()
                },
            ]
        );
        // The ids the TOC links to must exist in the HTML, or the outline is dead.
        for heading in &doc.toc {
            assert!(
                doc.html.contains(&format!("id=\"{}\"", heading.id)),
                "no anchor for {:?} in {}",
                heading.id,
                doc.html
            );
        }
    }

    #[test]
    fn duplicate_headings_get_distinct_anchors() {
        let doc = render("## Usage\n\n## Usage\n");
        assert_eq!(doc.toc[0].id, "usage");
        assert_eq!(doc.toc[1].id, "usage-1");
        assert!(doc.html.contains("id=\"usage-1\""));
    }

    #[test]
    fn title_is_the_first_h1_only() {
        assert_eq!(render("## Sub\n\n# Real\n").title.as_deref(), Some("Real"));
        assert_eq!(render("## Only a sub\n").title, None);
    }

    #[test]
    fn smart_punctuation_is_off_unless_asked_for() {
        let source = r#"He said "no" -- twice..."#;

        let plain = render(source).html;
        assert!(plain.contains(r#""no""#), "got {plain}");

        let smart = render_with(
            source,
            RenderOptions {
                smart_punctuation: true,
            },
        )
        .html;
        assert!(
            smart.contains('\u{201c}'),
            "expected curly quotes in {smart}"
        );
        assert!(smart.contains('\u{2013}'), "expected an en dash in {smart}");
    }

    #[test]
    fn renders_tables_with_alignment() {
        let out = html("| a | b |\n| :- | -: |\n| 1 | 2 |\n");
        // Matched without the closing bracket: every element now also carries a
        // `data-sourcepos` attribute.
        assert!(out.contains("<table"));
        assert!(out.contains("align=\"left\""));
        assert!(out.contains("align=\"right\""));
    }

    /// Every block a reader can put a caret in — and every atom they can jump to
    /// in the source view — has to say which lines of the file it came from.
    #[test]
    fn blocks_carry_their_source_position() {
        let out = html("# Title\n\nA paragraph.\n\n```rust\nlet x = 1;\n```\n");
        assert!(out.contains("<h1 data-sourcepos=\"1:1-1:7\""), "{out}");
        assert!(out.contains("<p data-sourcepos=\"3:1-3:12\""), "{out}");
        assert!(
            out.contains("<pre class=\"code-block\" data-sourcepos=\"5:1-7:3\""),
            "code fences must carry it too — they are an atom the source view \
             has to be able to jump to\n{out}"
        );
    }

    #[test]
    fn renders_task_lists_as_checkboxes() {
        let out = html("- [x] done\n- [ ] todo\n");
        assert!(out.contains("<input"), "{out}");
        assert!(out.contains("checked"), "{out}");
        assert!(
            !out.contains("disabled"),
            "a checkbox the reader cannot click cannot be ticked\n{out}"
        );
    }

    #[test]
    fn renders_footnotes() {
        let out = html("Text[^1]\n\n[^1]: The note.\n");
        assert!(out.contains("data-footnotes"), "{out}");
        assert!(out.contains("The note."));
    }

    #[test]
    fn renders_github_alerts() {
        for (marker, kind) in [
            ("NOTE", "note"),
            ("TIP", "tip"),
            ("IMPORTANT", "important"),
            ("WARNING", "warning"),
            ("CAUTION", "caution"),
        ] {
            let out = html(&format!("> [!{marker}]\n> Body text.\n"));
            assert!(
                out.contains(&format!("markdown-alert-{kind}")),
                "{marker} did not render an alert: {out}"
            );
        }
    }

    #[test]
    fn renders_strikethrough_super_and_subscript() {
        // No closing bracket: `<del>` gains a `data-sourcepos` attribute, while
        // `<sup>`/`<sub>` are inline and do not. Matching the tag start covers both.
        assert!(html("~~gone~~").contains("<del"));
        assert!(html("x^2^").contains("<sup"));
        assert!(html("H~2~O").contains("<sub"));
    }

    #[test]
    fn renders_math_for_katex_to_pick_up() {
        assert!(html("Inline $a^2$ math").contains("data-math-style=\"inline\""));
        assert!(html("$$\na^2\n$$\n").contains("data-math-style=\"display\""));
    }

    #[test]
    fn renders_emoji_shortcodes() {
        assert!(html("Ship it :tada:").contains('🎉'));
    }

    #[test]
    fn keeps_details_and_kbd_html() {
        let out = html("<details><summary>More</summary>\n\nHidden\n\n</details>\n");
        assert!(out.contains("<details>"), "{out}");
        assert!(out.contains("<summary>"), "{out}");
        assert!(html("Press <kbd>Ctrl</kbd>").contains("<kbd>"));
    }

    #[test]
    fn keeps_relative_links_and_images_for_the_frontend_to_resolve() {
        let out = html("[guide](./docs/guide.md) ![shot](img/a.png)");
        assert!(out.contains("href=\"./docs/guide.md\""), "{out}");
        assert!(out.contains("src=\"img/a.png\""), "{out}");
    }

    #[test]
    fn extracts_frontmatter_without_rendering_it() {
        let doc = render("---\ntitle: Hello\ntags: [a]\n---\n\n# Body\n");
        assert_eq!(doc.frontmatter.as_deref(), Some("title: Hello\ntags: [a]"));
        assert!(!doc.html.contains("title: Hello"));
        assert!(doc.html.contains("Body"));
    }

    // --- fences ------------------------------------------------------------

    #[test]
    fn mermaid_fences_become_a_source_block_for_the_webview() {
        let out = html("```mermaid\ngraph TD;\n  A-->B;\n```\n");
        assert!(out.contains("class=\"mermaid-src\""), "{out}");
        assert!(
            out.contains("A--&gt;B"),
            "mermaid source must stay escaped: {out}"
        );
        assert!(
            !out.contains("<svg"),
            "diagrams are rendered in the webview"
        );
    }

    #[test]
    fn code_fences_keep_the_language_for_shiki() {
        let out = html("```rust\nfn main() {}\n```\n");
        assert!(out.contains("data-lang=\"rust\""), "{out}");
        assert!(out.contains("class=\"language-rust\""), "{out}");
    }

    #[test]
    fn code_fences_expose_a_filename_when_the_info_string_has_one() {
        assert!(html("```ts title=\"main.ts\"\nx\n```\n").contains("data-title=\"main.ts\""));
        assert!(html("```ts:main.ts\nx\n```\n").contains("data-title=\"main.ts\""));
        assert!(!html("```ts\nx\n```\n").contains("data-title"));
    }

    #[test]
    fn plain_fences_render_without_a_language() {
        let out = html("```\nplain\n```\n");
        assert!(out.contains("class=\"code-block\""), "{out}");
        assert!(!out.contains("data-lang"), "{out}");
    }

    #[test]
    fn code_content_is_escaped_not_executed() {
        let out = html("```html\n<script>alert(1)</script>\n```\n");
        assert!(out.contains("&lt;script&gt;"), "{out}");
        assert!(!out.contains("<script>"), "{out}");
    }

    // --- sanitizing untrusted documents ------------------------------------

    #[test]
    fn strips_script_tags() {
        let out = html("Before\n\n<script>alert('xss')</script>\n\nAfter\n");
        assert!(!out.contains("<script"), "{out}");
        assert!(!out.contains("alert('xss')"), "{out}");
        assert!(out.contains("Before") && out.contains("After"));
    }

    #[test]
    fn strips_event_handler_attributes() {
        let out = html("<div onclick=\"steal()\">text</div>\n");
        assert!(!out.contains("onclick"), "{out}");
        assert!(out.contains("text"));
    }

    #[test]
    fn strips_javascript_and_data_html_urls() {
        assert!(!html("[click](javascript:alert(1))").contains("javascript:"));
        assert!(!html("[click](data:text/html;base64,PHNjcmlwdD4=)").contains("data:text/html"));
        // ...while leaving an ordinary link intact.
        assert!(html("[ok](https://example.com)").contains("https://example.com"));
    }

    #[test]
    fn strips_iframes_objects_and_forms() {
        for hostile in [
            "<iframe src=\"https://evil.test\"></iframe>",
            "<object data=\"x.swf\"></object>",
            "<form action=\"https://evil.test\"><input name=\"p\"></form>",
        ] {
            let out = html(hostile);
            assert!(!out.contains("<iframe"), "{out}");
            assert!(!out.contains("<object"), "{out}");
            assert!(!out.contains("<form"), "{out}");
        }
    }

    #[test]
    fn strips_style_attributes() {
        let out = html("<p style=\"position:fixed;top:0\">covering the chrome</p>\n");
        assert!(!out.contains("style="), "{out}");
    }

    #[test]
    fn strips_svg_script_vectors() {
        let out = html("<svg><script>alert(1)</script></svg>\n");
        assert!(!out.contains("<script"), "{out}");
        assert!(!out.contains("<svg"), "{out}");
    }

    // --- info-string parsing ------------------------------------------------

    #[test]
    fn title_from_info_handles_both_spellings_and_neither() {
        assert_eq!(title_from_info("ts title=\"a.ts\""), Some("a.ts".into()));
        assert_eq!(title_from_info("ts title='a.ts'"), Some("a.ts".into()));
        assert_eq!(title_from_info("ts:a.ts"), Some("a.ts".into()));
        assert_eq!(title_from_info("ts"), None);
        assert_eq!(title_from_info(""), None);
    }

    #[test]
    fn empty_document_renders_to_nothing_without_panicking() {
        let doc = render("");
        assert_eq!(doc.html.trim(), "");
        assert!(doc.toc.is_empty());
        assert_eq!(doc.title, None);
        assert_eq!(doc.frontmatter, None);
    }

    // --- forged sourcepos --------------------------------------------------

    /// The audit's repro, verbatim. A raw HTML block claiming another block's line
    /// range gave two elements one identity, so selecting the decoy and pressing
    /// Ctrl+B rewrote the real paragraph instead.
    #[test]
    fn a_document_cannot_forge_a_sourcepos() {
        let out =
            html("Real paragraph.\n\n<p data-sourcepos=\"1:1-1:15\">DECOY LONGER TEXT HERE</p>");

        assert!(
            out.contains("DECOY LONGER TEXT HERE"),
            "the decoy's text still renders, only its claim is removed: {out}"
        );
        assert_eq!(
            out.matches("data-sourcepos=\"1:1-1:15\"").count(),
            1,
            "exactly one element may claim a range — comrak's own: {out}"
        );
    }

    #[test]
    fn forged_sourcepos_is_stripped_in_every_spelling() {
        for forged in [
            "<p data-sourcepos=\"9:1-9:9\">x</p>",
            "<p data-sourcepos='9:1-9:9'>x</p>",
            "<p data-sourcepos=9:1-9:9>x</p>",
            "<p data-sourcepos = \"9:1-9:9\">x</p>",
            "<p DATA-SOURCEPOS=\"9:1-9:9\">x</p>",
            "<p\tdata-sourcepos=\"9:1-9:9\">x</p>",
        ] {
            let out = html(forged);
            assert!(
                !out.contains("9:1-9:9"),
                "a forged range survived `{forged}`: {out}"
            );
        }
    }

    #[test]
    fn inline_raw_html_cannot_forge_one_either() {
        let out = html("A <span data-sourcepos=\"1:1-1:1\">decoy</span> inline.");
        assert!(out.contains("decoy"), "{out}");
        assert!(!out.contains("data-sourcepos=\"1:1-1:1\""), "{out}");
    }

    /// The renderer's own attributes are the feature. Stripping them would break
    /// editing outright, which is the failure this guards against.
    #[test]
    fn comrak_sourcepos_still_reaches_the_html() {
        let out = html("# Title\n\nA paragraph.\n\n```rust\nfn main() {}\n```");
        assert!(out.contains("<h1 data-sourcepos=\"1:1-1:7\""), "{out}");
        assert!(out.contains("data-sourcepos=\"3:1-3:12\""), "{out}");
        // Written by `rewrite_code_blocks`, which deliberately runs after the strip.
        assert!(
            out.contains("<pre class=\"code-block\" data-sourcepos=\"5:1-7:3\""),
            "{out}"
        );
    }

    /// Over-eager stripping would corrupt documents that merely discuss the
    /// attribute — which this repo's own notes do.
    #[test]
    fn prose_and_code_mentioning_the_attribute_are_untouched() {
        let prose = html("The `data-sourcepos` attribute is read by the frontend.");
        assert!(prose.contains("data-sourcepos"), "{prose}");

        let fenced = html("```html\n<p data-sourcepos=\"1:1-1:5\">sample</p>\n```");
        assert!(
            fenced.contains("data-sourcepos"),
            "a fenced sample is text, not markup: {fenced}"
        );
    }
}
