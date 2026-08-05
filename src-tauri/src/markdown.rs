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

    // --- the sanitizer, as properties ---------------------------------------
    //
    // comrak renders with `unsafe_` on, so ammonia is the only thing between a
    // stranger's file and the webview. The example-based tests above prove specific
    // constructs survive; these prove that *nothing* which should not survive does,
    // over inputs nobody wrote by hand.
    //
    // An adversarial audit of this repo stopped at one hole in the allowlist and said
    // so plainly: that "ammonia is otherwise sound" was an assumption, not a result.
    // This is the attempt to make it a result.

    /// Things that must never appear in rendered output, whatever the input was.
    ///
    /// Checked against the lowercased HTML, because an attribute's case is not a
    /// defence — `OnErRoR=` runs exactly as well as `onerror=`.
    fn forbidden(html: &str) -> Option<String> {
        // Only what is inside a tag can execute. Escaped text cannot: comrak turns an
        // unterminated `<img src=x onerror=alert(1)` into `&lt;img src=x onerror=…`,
        // which is a paragraph that happens to read like an attack and is not one.
        // Scanning the raw string instead of the markup fails on that input, and the
        // first version of this check did exactly that.
        for tag in tags_in(html) {
            let lower = tag.to_lowercase();

            let name: String = lower
                .trim_start_matches('<')
                .trim_start_matches('/')
                .chars()
                .take_while(char::is_ascii_alphanumeric)
                .collect();
            if FORBIDDEN_TAGS.contains(&name.as_str()) {
                return Some(format!("output contains a <{name}> element"));
            }

            if let Some(found) = dangerous_url_scheme(tag) {
                return Some(format!("a tag carries {found}: {tag}"));
            }
            for attribute in ["srcdoc", "formaction", "xlink:href"] {
                if lower.contains(attribute) {
                    return Some(format!("a tag carries `{attribute}`: {tag}"));
                }
            }

            if let Some(handler) = event_handler_in(&lower) {
                return Some(format!(
                    "a tag carries the event handler `{handler}=`: {tag}"
                ));
            }
        }

        None
    }

    /// Attributes whose value a browser will actually navigate to or fetch. A scheme
    /// anywhere else in a tag is text.
    const URL_ATTRIBUTES: &[&str] = &[
        "href",
        "src",
        "srcset",
        "action",
        "formaction",
        "data",
        "poster",
        "background",
        "xlink:href",
    ];

    /// A dangerous scheme in an attribute that is a URL, if there is one.
    ///
    /// Scoped this way because the blunt version — "the tag contains `javascript:`" —
    /// is wrong, and the property test proved it. A fence whose info string is
    /// `![image](javascript:alert(1))` renders as
    /// `<pre data-lang="![image](javascript:alert(1))">`: the text is attacker-chosen,
    /// it is HTML-escaped by `rewrite_code_blocks`, and `data-lang` is not a URL, so
    /// nothing navigates anywhere. Flagging it taught the test to fail on safe output,
    /// which is how a security test gets weakened until it checks nothing.
    fn dangerous_url_scheme(tag: &str) -> Option<String> {
        let lower = tag.to_lowercase();
        let bytes = lower.as_bytes();

        for name in URL_ATTRIBUTES {
            let mut from = 0;
            while let Some(offset) = lower.get(from..).and_then(|rest| rest.find(name)) {
                let at = from + offset;
                from = at + name.len();

                // Must be a whole attribute name: preceded by whitespace or a quote.
                let preceded_ok = at > 0
                    && bytes
                        .get(at - 1)
                        .is_some_and(|b| b.is_ascii_whitespace() || *b == b'"' || *b == b'\'');
                if !preceded_ok {
                    continue;
                }

                // …then optional whitespace, `=`, optional whitespace, optional quote.
                let mut i = from;
                while bytes.get(i).is_some_and(u8::is_ascii_whitespace) {
                    i = i.saturating_add(1);
                }
                if bytes.get(i) != Some(&b'=') {
                    continue;
                }
                i = i.saturating_add(1);
                while bytes
                    .get(i)
                    .is_some_and(|b| b.is_ascii_whitespace() || *b == b'"' || *b == b'\'')
                {
                    i = i.saturating_add(1);
                }

                let value = lower.get(i..).unwrap_or_default();
                for scheme in ["javascript:", "vbscript:", "data:text/html"] {
                    if value.starts_with(scheme) {
                        return Some(format!("{name}=\"{scheme}…\""));
                    }
                }
            }
        }
        None
    }

    const FORBIDDEN_TAGS: &[&str] = &[
        "script", "iframe", "object", "embed", "form", "style", "base", "link", "meta", "template",
        "noscript", "svg", "math", "button",
    ];

    /// Every `<…>` region of the output — tags only. Escaped text never contains a
    /// literal `<`, so anything found here really is markup.
    fn tags_in(html: &str) -> Vec<&str> {
        let mut tags = Vec::new();
        let bytes = html.as_bytes();
        let mut i = 0;
        while let Some(offset) = bytes
            .get(i..)
            .and_then(|r| r.iter().position(|b| *b == b'<'))
        {
            let from = i + offset;
            if let Some(close) = bytes
                .get(from..)
                .and_then(|r| r.iter().position(|b| *b == b'>'))
            {
                if let Some(tag) = html.get(from..=from + close) {
                    tags.push(tag);
                }
                i = from + close + 1;
            } else {
                // An unterminated `<` at the end: take the remainder so it is still
                // inspected rather than silently skipped.
                if let Some(rest) = html.get(from..) {
                    tags.push(rest);
                }
                break;
            }
        }
        tags
    }

    /// The name of an `on…=` attribute inside a tag, if there is one.
    ///
    /// Scanned rather than matched against a list of event names: that list is long, it
    /// grows, and enumerating it is the wrong side of the allowlist argument —
    /// `onbeforetoggle` reached browsers years after this app was written.
    fn event_handler_in(tag: &str) -> Option<String> {
        let bytes = tag.as_bytes();
        for i in 0..bytes.len() {
            if bytes.get(i..i.saturating_add(2)) != Some(b"on") {
                continue;
            }
            // An attribute name begins after whitespace or a quote, never mid-word.
            let starts = i > 0
                && bytes
                    .get(i - 1)
                    .is_some_and(|b| b.is_ascii_whitespace() || *b == b'"' || *b == b'\'');
            if !starts {
                continue;
            }
            let rest = bytes.get(i.saturating_add(2)..).unwrap_or_default();
            let len = rest.iter().take_while(|b| b.is_ascii_alphabetic()).count();
            if len == 0 {
                continue;
            }
            if rest.get(len) == Some(&b'=') {
                return tag
                    .get(i..i.saturating_add(2).saturating_add(len))
                    .map(str::to_owned);
            }
        }
        None
    }

    /// Fragments a hostile document is built from. Real vectors rather than random
    /// bytes: fuzzing a Markdown parser with noise mostly produces paragraphs, and the
    /// interesting inputs are the ones shaped like the thing being defended against.
    const HOSTILE: &[&str] = &[
        r"<script>alert(1)</script>",
        r"<ScRiPt>alert(1)</ScRiPt>",
        r"<img src=x onerror=alert(1)>",
        r"<img src=x OnErRoR=alert(1)>",
        r#"<img src="x" onload='alert(1)'>"#,
        r#"<a href="javascript:alert(1)">click</a>"#,
        r#"<a href="JaVaScRiPt:alert(1)">click</a>"#,
        r#"<a href="&#106;avascript:alert(1)">entity encoded</a>"#,
        r#"<a href="java&#x09;script:alert(1)">tab split</a>"#,
        r"[markdown link](javascript:alert(1))",
        r"[entity link](&#106;avascript:alert%281%29)",
        r"![image](javascript:alert(1))",
        r#"<iframe src="https://example.com"></iframe>"#,
        r#"<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>"#,
        r#"<object data="x.swf"></object>"#,
        r#"<embed src="x.swf">"#,
        r#"<form action="https://example.com"><button formaction="javascript:alert(1)">go</button></form>"#,
        r"<style>body{background:url(https://example.com/x)}</style>",
        r#"<base href="https://example.com/">"#,
        r#"<link rel="stylesheet" href="https://example.com/x.css">"#,
        r#"<meta http-equiv="refresh" content="0;url=https://example.com">"#,
        r"<svg><script>alert(1)</script></svg>",
        r"<svg onload=alert(1)></svg>",
        r"<math><mtext><script>alert(1)</script></mtext></math>",
        r"<template><script>alert(1)</script></template>",
        r#"<noscript><p title="</noscript><script>alert(1)</script>">"#,
        r#"<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data uri</a>"#,
        r#"<div onclick="alert(1)">click</div>"#,
        r#"<details open ontoggle="alert(1)"><summary>s</summary>x</details>"#,
        r#"<input type="checkbox" onfocus="alert(1)" autofocus>"#,
        r"<p onbeforetoggle=alert(1)>a handler invented after this app was written</p>",
        // Malformed and unterminated markup — the shapes a parser most often disagrees on.
        r"<script",
        r"<img src=x onerror=alert(1)",
        r"<<script>alert(1)//<</script>",
        r#"<a href="x" ="y" onerror=alert(1)>odd attribute</a>"#,
        // Ordinary content, so a generated document is a mixture rather than pure attack.
        "# A heading",
        "Some **bold** prose with a [real link](https://example.com).",
        "- [ ] a task\n- [x] a done task",
        "| a | b |\n| --- | --- |\n| 1 | 2 |",
        "> [!NOTE]\n> An alert.",
        "```rust\nfn main() {}\n```",
        "$x^2$ and $$y$$",
        "A footnote[^1].\n\n[^1]: The note.",
        "<details><summary>Fine</summary>This is allowed.</details>",
        "<kbd>Ctrl</kbd>",
    ];

    #[test]
    fn every_hostile_fragment_is_neutralized_on_its_own() {
        for fragment in HOSTILE {
            let out = html(fragment);
            assert!(
                forbidden(&out).is_none(),
                "fragment {fragment:?} produced {:?}\n{out}",
                forbidden(&out)
            );
        }
    }

    proptest::proptest! {
        // A composed document, because parsers disagree about *combinations*: raw HTML
        // interrupted by a fence, a link inside an unterminated tag, a table cell
        // holding markup. Single fragments are covered above; this is about the seams.
        #![proptest_config(proptest::prelude::ProptestConfig::with_cases(400))]

        #[test]
        fn no_composition_of_hostile_fragments_survives_the_sanitizer(
            indices in proptest::collection::vec(0usize..HOSTILE.len(), 1..8),
            separator in proptest::sample::select(vec!["\n\n", "\n", " ", "\n> ", "\n- "]),
        ) {
            let source: String = indices
                .iter()
                .map(|i| HOSTILE[*i])
                .collect::<Vec<_>>()
                .join(separator);

            let out = html(&source);
            proptest::prop_assert!(
                forbidden(&out).is_none(),
                "{:?}\n--- source ---\n{source}\n--- output ---\n{out}",
                forbidden(&out)
            );
        }

        /// The same, with the reader's other setting on. `smart` changes the parse, and
        /// a sanitizer that only holds under one set of options is not a sanitizer.
        #[test]
        fn smart_punctuation_does_not_open_anything(
            indices in proptest::collection::vec(0usize..HOSTILE.len(), 1..6),
        ) {
            let source: String = indices
                .iter()
                .map(|i| HOSTILE[*i])
                .collect::<Vec<_>>()
                .join("\n\n");

            let out = render_with(&source, RenderOptions { smart_punctuation: true }).html;
            proptest::prop_assert!(forbidden(&out).is_none(), "{:?}", forbidden(&out));
        }
    }

    /// The allowlist, pinned.
    ///
    /// Not a property — a tripwire. Widening `sanitizer()` is sometimes right, and this
    /// exists so that it is always deliberate: adding a tag or an attribute means
    /// editing this list too, and explaining why in the diff. The audit's finding was
    /// an entry nobody had re-read in a long time.
    #[test]
    fn the_allowlist_is_what_we_think_it_is() {
        // A tag that is allowed and must stay allowed: each is load-bearing for a
        // GitHub-flavored construct this app renders.
        for markup in [
            "<details><summary>s</summary>body</details>",
            "<kbd>Ctrl</kbd>",
            "<sub>sub</sub>",
            "<sup>sup</sup>",
        ] {
            let out = html(markup);
            let tag = markup.split(['<', '>']).nth(1).unwrap_or_default();
            assert!(
                out.contains(&format!("<{tag}")),
                "{tag} should survive: {out}"
            );
        }

        // `disabled` is deliberately stripped from task-list checkboxes, so the one
        // edit a reader can make without a caret keeps working.
        let task = html("- [ ] a task");
        assert!(task.contains("<input"), "{task}");
        assert!(task.contains(r#"type="checkbox""#), "{task}");
        assert!(
            !task.contains("disabled"),
            "checkbox must stay clickable: {task}"
        );

        // Only navigable schemes survive on a link.
        assert!(html("[x](https://example.com)").contains("https://example.com"));
        assert!(html("[x](mailto:a@example.com)").contains("mailto:"));
        assert!(
            html("[x](./other.md)").contains("./other.md"),
            "relative links are the point"
        );
        assert!(!html("[x](ftp://example.com/f)").contains("ftp://"));
    }
}
