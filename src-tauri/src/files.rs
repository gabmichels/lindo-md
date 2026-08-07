//! Reading documents, scanning folders, and watching both for changes.
//!
//! This is the only module that touches the filesystem. The webview has no `fs`
//! permission at all, so every path that reaches disk arrives through one of the
//! commands here.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{LindoError, LindoResult};
use crate::markdown::{self, Heading};
use crate::{mdx, plaintext, srcmap};

/// Rendered by comrak and editable: `data-sourcepos` addresses the file on disk
/// byte for byte, which is what lets a keystroke in the rendered view rewrite the
/// right run of the source.
pub const MARKDOWN_EXTENSIONS: [&str; 7] = ["md", "markdown", "mdown", "mkd", "mkdn", "qmd", "rmd"];

/// Rendered by comrak too, but **read-only**, and the reason is not squeamishness.
///
/// MDX is Markdown with JSX in it, and comrak runs with `unsafe_` on: a
/// `<Callout>Body</Callout>` reaches ammonia as raw HTML, which strips the unknown
/// element and keeps its children — so the document silently renders `Body` with no
/// sign a component was ever there. `mdx::prepass` fences those blocks so they show
/// as code instead, and that is exactly what costs the edit path: inserting fence
/// lines shifts every `data-sourcepos` below them, while `Document::source` is still
/// the file on disk. Render the transformed string and every edit rewrites the wrong
/// bytes; save the transformed string and the reader's `import` lines are destroyed.
/// Editing MDX needs a line-delta map between the two strings, which is its own
/// change with its own trust boundary.
pub const MDX_EXTENSIONS: [&str; 1] = ["mdx"];

/// Shown verbatim and read-only. These never reach comrak — a `.txt` containing
/// `# TODO` has to render those characters, not a heading.
pub const PLAIN_TEXT_EXTENSIONS: [&str; 5] = ["txt", "text", "log", "rst", "adoc"];

/// A `.log` is the one plain-text case that is usually column-aligned, so it is the
/// one that wants a mono face. Everything else in `PLAIN_TEXT_EXTENSIONS` is prose.
pub const MONO_EXTENSIONS: [&str; 1] = ["log"];

/// How long to wait for a burst of filesystem events to settle. Editors save by
/// writing a temp file and renaming it, which produces three or four events for
/// one logical change; re-rendering on each would flicker.
const DEBOUNCE: Duration = Duration::from_millis(200);

/// Folders that are never worth showing in a document tree and are expensive to
/// walk. `.gitignore` covers most of these in a git repo, but the tree also has
/// to behave in a plain directory.
const SKIP_DIRS: [&str; 8] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".venv",
    "__pycache__",
];

const MAX_DEPTH: usize = 12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub path: String,
    /// The document's own directory. Relative links and images resolve against it.
    pub dir: String,
    pub name: String,
    pub html: String,
    pub toc: Vec<Heading>,
    pub frontmatter: Option<String>,
    /// First `#` heading, falling back to the file name so the titlebar always
    /// has something to show.
    pub title: String,
    /// **The file on disk**, always — never a transformed version of it. Editing
    /// applies to this string rather than to the rendered HTML, so the frontend needs
    /// it to make any change at all, and for a text file it costs nothing to send.
    ///
    /// For MDX this is deliberately *not* what comrak was given: `mdx::prepass` runs
    /// first, and the two disagree line for line. That is exactly why MDX is
    /// read-only, and why nothing may quietly start storing the prepared string here
    /// to make an edit path work.
    pub source: String,
    /// Fingerprint of `source`, handed back on save so a file that changed
    /// underneath the reader is refused rather than silently overwritten.
    pub content_hash: String,
    /// Where each block's rendered text lives in `source`, keyed by the
    /// `data-sourcepos` attribute on the element it rendered to. Sent with the
    /// document rather than fetched on demand: it describes exactly this
    /// `source` and this `html`, and a map that could be one version behind is
    /// worse than no map at all.
    pub blocks: Vec<srcmap::BlockMap>,
    /// Whether an edit made in the rendered view can be written back.
    ///
    /// A mirror of `is_editable` for the UI to hang affordances off — it is not what
    /// enforces anything. `save` refuses independently, because the webview is
    /// untrusted and a read-only document that is only read-only in React is not
    /// read-only at all.
    ///
    /// False for plain text, which has no Markdown to rewrite, and for MDX, whose
    /// pre-pass moves every line number out from under `data-sourcepos`.
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

/// What a path is, and therefore how it renders and whether it can be written back.
///
/// Keeping the derived predicates distinct is the whole point: a file can be
/// *openable* without being *editable*, and — separately, over in `links.ts` — without
/// being something a link inside a document should capture into a tab.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Markdown,
    Mdx,
    PlainText,
}

/// The extension, lowercased once, or `None` for a path lindo-md will not open.
pub fn kind_of(path: &Path) -> Option<Kind> {
    let extension = path.extension().and_then(|e| e.to_str())?.to_lowercase();
    let extension = extension.as_str();

    if MARKDOWN_EXTENSIONS.contains(&extension) {
        Some(Kind::Markdown)
    } else if MDX_EXTENSIONS.contains(&extension) {
        Some(Kind::Mdx)
    } else if PLAIN_TEXT_EXTENSIONS.contains(&extension) {
        Some(Kind::PlainText)
    } else {
        None
    }
}

/// Anything lindo-md can display. The gate on reading, on what the tree lists, and
/// on what the OS hand-off accepts.
pub fn is_openable(path: &Path) -> bool {
    kind_of(path).is_some()
}

// There is deliberately no `is_markdown` here. A third predicate does exist — "is this
// a link a document should be allowed to capture into a tab, rather than hand to the
// reader's own editor?" — but its only call site is `links.ts`, and a helper with no
// caller on this side is dead code that `-D warnings` turns into a failed build. It
// lives in `src/lib/utils.ts` as `isMarkdownPath`, beside the code that asks.

/// Whether an edit made in the rendered view can be written back to this file.
///
/// Narrower than `is_openable` on purpose — MDX opens but does not save, and
/// `MDX_EXTENSIONS` explains why. This is the predicate `save` enforces, and it is
/// enforced *here* rather than in the webview because the webview is untrusted: a
/// read-only document that is only read-only in React is not read-only.
pub fn is_editable(path: &Path) -> bool {
    matches!(kind_of(path), Some(Kind::Markdown))
}

/// Whether a plain-text document should be set in a mono face. See `MONO_EXTENSIONS`.
fn wants_mono(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MONO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
}

/// The supported extensions as a reader would write them, for the one error message
/// that has to name them. Generated rather than restated: a user-facing list that can
/// disagree with the code is how the old four-item list drifted into four other files.
pub fn supported_list() -> String {
    MARKDOWN_EXTENSIONS
        .iter()
        .chain(MDX_EXTENSIONS.iter())
        .chain(PLAIN_TEXT_EXTENSIONS.iter())
        .map(|extension| format!(".{extension}"))
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn read(
    app: &AppHandle,
    path: &Path,
    render_options: markdown::RenderOptions,
) -> LindoResult<Document> {
    let Some(kind) = kind_of(path) else {
        return Err(LindoError::UnsupportedFile(path.display().to_string()));
    };

    let source = std::fs::read_to_string(path).map_err(|source| LindoError::ReadFile {
        path: path.display().to_string(),
        source,
    })?;

    let content_hash = hash(&source);
    Ok(render(
        app,
        path,
        kind,
        source,
        content_hash,
        render_options,
    ))
}

/// Builds the document from Markdown already in hand.
///
/// Split out of `read` for `save`, which has just written this exact string and
/// knows its hash: re-reading the file to render it meant a third trip to the
/// disk per keystroke-batch, and a second SHA-256 of the whole document, for a
/// string already sitting in memory. It also meant the render could, in
/// principle, describe a *different* file — one something else rewrote in the
/// gap between the write and the read back.
fn render(
    app: &AppHandle,
    path: &Path,
    kind: Kind,
    source: String,
    content_hash: String,
    render_options: markdown::RenderOptions,
) -> Document {
    let dir = path
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);

    // The asset protocol is deny-all by default (see tauri.conf.json). Granting
    // the document's own directory — and only that — is what lets `![](img/a.png)`
    // resolve, without giving the webview a window onto the whole disk.
    let _ = app.asset_protocol_scope().allow_directory(&dir, true);

    let name = path.file_name().map_or_else(
        || path.display().to_string(),
        |n| n.to_string_lossy().into_owned(),
    );

    // Plain text short-circuits everything below: no comrak, no heading to take a
    // title from, no table of contents, and no source map, because there is no
    // Markdown here for a `data-sourcepos` to point into.
    if kind == Kind::PlainText {
        return Document {
            path: path.display().to_string(),
            dir: dir.display().to_string(),
            html: plaintext::render(&source, wants_mono(path)),
            toc: Vec::new(),
            frontmatter: None,
            title: name.clone(),
            name,
            content_hash,
            blocks: Vec::new(),
            editable: false,
            source,
        };
    }

    // MDX renders through comrak like any dialect, but only after its JSX has been
    // fenced — otherwise ammonia strips the components and keeps their text. That
    // transform is also why the document is read-only: `rendered` describes
    // `prepared`, while `source` (and therefore any save) is the file on disk, and
    // the two no longer agree line for line.
    let prepared = match kind {
        Kind::Mdx => std::borrow::Cow::Owned(mdx::prepass(&source)),
        _ => std::borrow::Cow::Borrowed(source.as_str()),
    };

    let rendered = markdown::render_with(&prepared, render_options);
    let title = rendered.title.clone().unwrap_or_else(|| name.clone());

    Document {
        path: path.display().to_string(),
        dir: dir.display().to_string(),
        name,
        html: rendered.html,
        toc: rendered.toc,
        frontmatter: rendered.frontmatter,
        title,
        content_hash,
        // Only ever built from the string that was actually rendered, and only when
        // that string is the file itself. An MDX map would address `prepared`, whose
        // line numbers the pre-pass has moved.
        blocks: match kind {
            Kind::Markdown => srcmap::for_webview(&source, render_options),
            _ => Vec::new(),
        },
        editable: kind == Kind::Markdown,
        source,
    }
}

/// A content fingerprint. Used to decide whether a file changed, never to
/// authenticate anything — two documents colliding here would mean a refused
/// save, not a security failure.
pub fn hash(contents: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(contents.as_bytes()))
}

/// Fails unless `path` still holds exactly what the caller last saw.
///
/// This is the whole data-loss guard. Without it an edit made against a document
/// the reader opened ten minutes ago would overwrite whatever a `git checkout`,
/// another editor, or the far side of a sync had written since — work nobody
/// ever had the chance to look at.
fn ensure_unchanged(path: &Path, expected_hash: &str) -> LindoResult<()> {
    let current = std::fs::read_to_string(path).map_err(|source| LindoError::ReadFile {
        path: path.display().to_string(),
        source,
    })?;
    if hash(&current) != expected_hash {
        return Err(LindoError::StaleWrite {
            path: path.display().to_string(),
        });
    }
    Ok(())
}

/// Writes an edited document back to disk and re-renders it.
///
/// `expected_hash` is the fingerprint the caller last saw. If the file no longer
/// matches it, something else has written to it — another editor, a `git
/// checkout`, the other half of a sync — and the write is refused. Overwriting
/// would silently destroy work the reader never saw.
pub fn save(
    app: &AppHandle,
    state: &WatchState,
    path: &Path,
    source: &str,
    expected_hash: &str,
    render_options: markdown::RenderOptions,
) -> LindoResult<Document> {
    // Narrower than `read`, and that difference *is* the read-only rule. The webview
    // is untrusted, so a document being read-only cannot rest on a React prop: a
    // compromised frontend calling `save_document("notes.log", …)` has to be refused
    // here. `Document.editable` mirrors this for the UI; it does not implement it.
    if !is_editable(path) {
        return Err(LindoError::UnsupportedFile(path.display().to_string()));
    }

    ensure_unchanged(path, expected_hash)?;

    let content_hash = hash(source);

    // Recorded *before* the write, so the event this write is about to cause
    // cannot arrive before the watcher knows to ignore it.
    state.expect_write(path, &content_hash);

    std::fs::write(path, source).map_err(|source| LindoError::WriteFile {
        path: path.display().to_string(),
        source,
    })?;

    // Rendered from what was written rather than from a fresh read of the file.
    // See `render`. The kind is `Markdown` by construction: `is_editable` above is
    // exactly the predicate that admits nothing else.
    Ok(render(
        app,
        path,
        Kind::Markdown,
        source.to_owned(),
        content_hash,
        render_options,
    ))
}

/// What the reader has chosen to see in the rail. A struct rather than two bool
/// parameters, which at a call site are indistinguishable from each other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanOptions {
    pub respect_gitignore: bool,
    pub show_hidden: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            respect_gitignore: true,
            show_hidden: false,
        }
    }
}

/// Builds the document tree for a folder. Directories holding nothing openable at any
/// depth are dropped, so opening a source repository shows the docs rather than the
/// source layout.
///
/// "Openable" rather than "Markdown": a folder of notes usually holds a `.txt` or a
/// `.log` beside them, and a tree that hides a file the app will happily open is the
/// more confusing of the two failures.
pub fn scan(root: &Path, options: ScanOptions) -> LindoResult<Vec<TreeNode>> {
    if !root.is_dir() {
        return Err(LindoError::msg(format!(
            "{} is not a folder",
            root.display()
        )));
    }

    let respect_gitignore = options.respect_gitignore;
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(!options.show_hidden)
        .git_ignore(respect_gitignore)
        .git_global(respect_gitignore)
        .git_exclude(respect_gitignore)
        .parents(respect_gitignore)
        .max_depth(Some(MAX_DEPTH))
        .filter_entry(|entry| {
            entry
                .file_name()
                .to_str()
                .is_none_or(|name| !SKIP_DIRS.contains(&name))
        });

    // Collect the openable files first, then rebuild the directory structure from
    // their paths. Walking and pruning in one pass would need to look ahead to
    // know whether a directory contains anything worth keeping.
    //
    // `is_openable`, not `is_markdown`: a real folder holds notes and logs beside
    // its Markdown, and a tree that hides a file the app can open is worse than a
    // tree with a `.log` in it.
    let mut files: Vec<PathBuf> = builder
        .build()
        .filter_map(Result::ok)
        .map(ignore::DirEntry::into_path)
        .filter(|path| path.is_file() && is_openable(path))
        .collect();
    files.sort();

    Ok(build_tree(root, &files))
}

fn build_tree(root: &Path, files: &[PathBuf]) -> Vec<TreeNode> {
    let mut dirs: Vec<TreeNode> = Vec::new();
    let mut leaves: Vec<TreeNode> = Vec::new();
    let mut seen_dirs: HashSet<String> = HashSet::new();

    for file in files {
        let Ok(relative) = file.strip_prefix(root) else {
            continue;
        };
        let mut parts = relative.components();
        let Some(first) = parts.next() else { continue };
        let first_name = first.as_os_str().to_string_lossy().into_owned();

        if parts.next().is_none() {
            leaves.push(TreeNode {
                name: first_name,
                path: file.display().to_string(),
                is_dir: false,
                children: Vec::new(),
            });
            continue;
        }

        if seen_dirs.insert(first_name.clone()) {
            let child_root = root.join(&first_name);
            let nested: Vec<PathBuf> = files
                .iter()
                .filter(|f| f.starts_with(&child_root))
                .cloned()
                .collect();
            dirs.push(TreeNode {
                name: first_name,
                path: child_root.display().to_string(),
                is_dir: true,
                children: build_tree(&child_root, &nested),
            });
        }
    }

    // Folders above files, each alphabetical — the order a reader expects from a
    // file tree, and stable across platforms whose walk order differs.
    dirs.sort_by_key(|node| node.name.to_lowercase());
    leaves.sort_by_key(|node| node.name.to_lowercase());
    dirs.extend(leaves);
    dirs
}

/// Holds the live watcher. Replacing it drops the previous one, which is how a
/// watch is cancelled — `notify` has no "unwatch everything" call.
#[derive(Default)]
pub struct WatchState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// What we last wrote to a path, so the filesystem event our own write causes
    /// can be told apart from someone else's.
    ///
    /// Matched on content rather than on a time window: a reader typing steadily
    /// produces a save every few hundred milliseconds, and any window wide enough
    /// to cover a slow disk would also swallow a real external change.
    written: Mutex<HashMap<PathBuf, String>>,
}

impl WatchState {
    /// Records the content about to be written to `path`.
    pub fn expect_write(&self, path: &Path, hash: &str) {
        if let Ok(mut written) = self.written.lock() {
            written.insert(path.to_path_buf(), hash.to_owned());
        }
    }

    /// Whether a change to `path` is the write we just made. Consumes the
    /// record: a second change to the same content really is someone else, and
    /// the reader should see it.
    fn is_our_write(&self, path: &Path) -> bool {
        let Ok(mut written) = self.written.lock() else {
            return false;
        };
        let Some(expected) = written.get(path) else {
            return false;
        };
        let Ok(current) = std::fs::read_to_string(path) else {
            return false;
        };
        if &hash(&current) != expected {
            return false;
        }
        written.remove(path);
        true
    }
}

/// Watches every open document and, optionally, the open folder. Emits:
///
/// - `document-changed` with the path, when an open file's contents change
/// - `tree-changed`, when openable files appear or disappear in the folder
///
/// Takes the whole set of open documents rather than one: with tabs, a file
/// edited outside the app has to live-reload whether or not its tab happens to
/// be the visible one.
pub fn watch(
    app: &AppHandle,
    state: &WatchState,
    documents: Vec<PathBuf>,
    folder: Option<PathBuf>,
) -> LindoResult<()> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            // A failed send only means the receiver thread is gone, which happens
            // when the watch is replaced; there is nothing to recover.
            let _ = tx.send(event);
        }
    })
    .map_err(|e| LindoError::msg(format!("Could not start watching for changes: {e}")))?;

    if let Some(folder) = &folder {
        watcher
            .watch(folder, RecursiveMode::Recursive)
            .map_err(|e| LindoError::msg(format!("Could not watch {}: {e}", folder.display())))?;
    }

    // Each file is watched through its parent directory: editors that save by
    // rename replace the inode, and a watch on the old one goes deaf. Parents
    // already inside the recursive folder watch are skipped, and so are repeats
    // — ten tabs on one folder must not mean ten watches on it.
    let mut registered: Vec<PathBuf> = Vec::new();
    for parent in documents.iter().filter_map(|path| path.parent()) {
        let covered = folder
            .as_deref()
            .is_some_and(|folder| parent.starts_with(folder));
        if covered || registered.iter().any(|seen| seen == parent) {
            continue;
        }
        registered.push(parent.to_path_buf());
        watcher
            .watch(parent, RecursiveMode::NonRecursive)
            .map_err(|e| LindoError::msg(format!("Could not watch {}: {e}", parent.display())))?;
    }

    let handle = app.clone();
    std::thread::spawn(move || debounce_loop(handle, rx, documents));

    // Dropping the previous watcher here also ends its receiver thread, because
    // the channel sender it held goes with it.
    *state
        .watcher
        .lock()
        .map_err(|_| LindoError::msg("Watch state was poisoned"))? = Some(watcher);
    Ok(())
}

/// Coalesces a burst of filesystem events into at most one emit per kind.
/// Returns when the channel closes, i.e. when the watcher is dropped.
fn debounce_loop(
    app: AppHandle,
    rx: mpsc::Receiver<notify::Event>,
    documents: Vec<PathBuf>,
) -> Option<()> {
    loop {
        // Block until something happens, then drain whatever else arrives inside
        // the debounce window before deciding what to emit.
        let mut batch = vec![rx.recv().ok()?];
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(event) => batch.push(event),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return None,
            }
        }

        let (changed, tree_changed) = classify(&batch, &documents);
        for path in changed {
            // Our own save comes back as a change like any other. Reloading on it
            // would throw away the caret — and, mid-edit, the reader's place in a
            // sentence they are still typing.
            if app.state::<WatchState>().is_our_write(&path) {
                continue;
            }
            let _ = app.emit("document-changed", path.display().to_string());
        }
        if tree_changed {
            let _ = app.emit("tree-changed", ());
        }
    }
}

/// Splits a batch of events into "these open documents changed" and "the set of
/// documents changed". Split out from the loop so it can be tested without a
/// filesystem or a running app.
///
/// Each changed document appears once however many events named it, so a save
/// burst across several open files produces one reload each.
fn classify(events: &[notify::Event], documents: &[PathBuf]) -> (Vec<PathBuf>, bool) {
    let mut changed: Vec<PathBuf> = Vec::new();
    let mut tree_changed = false;

    for event in events {
        for path in &event.paths {
            match documents
                .iter()
                .find(|open| open.as_path() == path.as_path())
            {
                Some(open) => {
                    if !changed.contains(open) {
                        changed.push(open.clone());
                    }
                }
                // A path with no extension is most likely a directory being added
                // or removed; either way the tree needs a refresh. Openable rather
                // than Markdown, so the tree tracks everything it lists.
                None if is_openable(path) || path.extension().is_none() => {
                    tree_changed = true;
                }
                None => {}
            }
        }
    }

    (changed, tree_changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_markdown_extensions_case_insensitively() {
        for name in [
            "a.md",
            "a.MD",
            "a.markdown",
            "a.mdown",
            "a.mkd",
            "a.mkdn",
            "a.qmd",
            "a.RMD",
        ] {
            assert_eq!(kind_of(Path::new(name)), Some(Kind::Markdown), "{name}");
        }
    }

    #[test]
    fn classifies_mdx_and_plain_text_separately() {
        for name in ["a.mdx", "a.MDX"] {
            assert_eq!(kind_of(Path::new(name)), Some(Kind::Mdx), "{name}");
        }
        for name in ["a.txt", "a.TEXT", "a.log", "a.rst", "a.adoc"] {
            assert_eq!(kind_of(Path::new(name)), Some(Kind::PlainText), "{name}");
        }
        for name in ["a.rs", "a.png", "a.json", "a"] {
            assert_eq!(kind_of(Path::new(name)), None, "{name}");
        }
    }

    /// `is_openable` gates what opens; `is_editable` gates what `save` will write.
    /// The gap between them is the read-only rule, and it is the whole reason both
    /// exist rather than one.
    #[test]
    fn openable_is_wider_than_editable_and_that_gap_is_the_read_only_rule() {
        let markdown = Path::new("a.md");
        let mdx = Path::new("a.mdx");
        let text = Path::new("a.txt");

        for path in [markdown, mdx, text] {
            assert!(is_openable(path), "{} should open", path.display());
        }
        assert!(!is_openable(Path::new("a.png")));

        assert!(is_editable(markdown));
        assert!(!is_editable(mdx), "the JSX pre-pass shifts every sourcepos");
        assert!(!is_editable(text), "there is no Markdown to rewrite");
    }

    #[test]
    fn the_supported_list_names_every_openable_extension() {
        let list = supported_list();
        for extension in MARKDOWN_EXTENSIONS
            .iter()
            .chain(MDX_EXTENSIONS.iter())
            .chain(PLAIN_TEXT_EXTENSIONS.iter())
        {
            assert!(list.contains(&format!(".{extension}")), "{extension}");
        }
    }

    #[test]
    fn only_log_files_ask_for_a_mono_face() {
        assert!(wants_mono(Path::new("build.log")));
        assert!(wants_mono(Path::new("build.LOG")));
        for name in ["notes.txt", "readme.rst", "a.md"] {
            assert!(!wants_mono(Path::new(name)), "{name}");
        }
    }

    fn tree(root: &str, files: &[&str]) -> Vec<TreeNode> {
        let root = PathBuf::from(root);
        let paths: Vec<PathBuf> = files.iter().map(|f| root.join(f)).collect();
        build_tree(&root, &paths)
    }

    #[test]
    fn tree_puts_folders_before_files_and_sorts_each_alphabetically() {
        let nodes = tree("/r", &["zebra.md", "alpha.md", "guides/b.md"]);
        let names: Vec<&str> = nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["guides", "alpha.md", "zebra.md"]);
        assert!(nodes[0].is_dir);
    }

    #[test]
    fn tree_nests_by_directory_without_duplicating_a_folder() {
        let nodes = tree("/r", &["docs/a.md", "docs/b.md", "docs/deep/c.md"]);
        assert_eq!(nodes.len(), 1, "one docs/ folder, not one per file");

        let docs = &nodes[0];
        assert_eq!(docs.name, "docs");
        let names: Vec<&str> = docs.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["deep", "a.md", "b.md"]);
        assert_eq!(docs.children[0].children[0].name, "c.md");
    }

    #[test]
    fn tree_is_empty_when_no_markdown_was_found() {
        assert!(tree("/r", &[]).is_empty());
    }

    #[test]
    fn scanning_hides_dotfiles_unless_asked_to_show_them() {
        let root = std::env::temp_dir().join("lindo-md-scan-hidden-test");
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::write(root.join("visible.md"), "# Visible").unwrap();
        std::fs::write(root.join(".hidden").join("secret.md"), "# Secret").unwrap();

        let names = |options| {
            let mut found: Vec<String> = Vec::new();
            fn walk(nodes: &[TreeNode], found: &mut Vec<String>) {
                for node in nodes {
                    found.push(node.name.clone());
                    walk(&node.children, found);
                }
            }
            walk(&scan(&root, options).unwrap(), &mut found);
            found.sort();
            found
        };

        // `respect_gitignore` is off so a .gitignore anywhere above the temp
        // directory cannot decide the outcome of this test.
        assert_eq!(
            names(ScanOptions {
                respect_gitignore: false,
                show_hidden: false
            }),
            vec!["visible.md"]
        );
        assert_eq!(
            names(ScanOptions {
                respect_gitignore: false,
                show_hidden: true
            }),
            vec![".hidden", "secret.md", "visible.md"]
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// The mixed folder this feature exists for: notes, a log and an MDX file beside
    /// the Markdown. Before, the rail showed the `.md` and nothing else, so a real
    /// working directory looked half-empty. Files lindo-md genuinely cannot open stay
    /// out, or the tree stops being a list of things you can click.
    #[test]
    fn scanning_lists_every_openable_file_and_nothing_else() {
        let root = std::env::temp_dir().join("lindo-md-scan-mixed-test");
        std::fs::create_dir_all(&root).unwrap();
        for name in [
            "notes.md",
            "guide.qmd",
            "post.mdx",
            "todo.txt",
            "build.log",
            "readme.rst",
            "diagram.png",
            "main.rs",
            "data.json",
        ] {
            std::fs::write(root.join(name), "x").unwrap();
        }

        let mut found: Vec<String> = scan(
            &root,
            ScanOptions {
                respect_gitignore: false,
                show_hidden: false,
            },
        )
        .unwrap()
        .into_iter()
        .map(|node| node.name)
        .collect();
        found.sort();

        assert_eq!(
            found,
            vec![
                "build.log",
                "guide.qmd",
                "notes.md",
                "post.mdx",
                "readme.rst",
                "todo.txt",
            ]
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn hash_distinguishes_content() {
        assert_eq!(hash("# Title\n"), hash("# Title\n"));
        assert_ne!(hash("# Title\n"), hash("# Title \n"));
    }

    /// The suppression is what stops a save from yanking the document out from
    /// under the caret, and what stops it from hiding somebody else's edit.
    #[test]
    fn our_own_write_is_recognized_once_and_only_by_content() {
        let dir = std::env::temp_dir().join("lindo-md-watch-suppression-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        std::fs::write(&path, "# Ours\n").unwrap();

        let state = WatchState::default();
        state.expect_write(&path, &hash("# Ours\n"));
        assert!(
            state.is_our_write(&path),
            "the write we just made must not reload the document"
        );
        assert!(
            !state.is_our_write(&path),
            "the record is consumed: a second change to the same file is somebody else"
        );

        // A write we expected, overtaken by different content on disk, is not
        // ours — that is an external edit and the reader has to see it.
        state.expect_write(&path, &hash("# Ours\n"));
        std::fs::write(&path, "# Theirs\n").unwrap();
        assert!(!state.is_our_write(&path));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The guard that stops an edit from overwriting work the reader never saw.
    #[test]
    fn a_save_is_refused_when_the_file_moved_underneath_it() {
        let dir = std::env::temp_dir().join("lindo-md-stale-write-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        std::fs::write(&path, "# As opened\n").unwrap();

        let opened = hash("# As opened\n");
        assert!(ensure_unchanged(&path, &opened).is_ok());

        // Somebody else writes: a git checkout, another editor, a sync.
        std::fs::write(&path, "# Somebody else's work\n").unwrap();
        let error = ensure_unchanged(&path, &opened).unwrap_err();
        assert!(
            matches!(error, LindoError::StaleWrite { .. }),
            "expected a refusal, got {error:?}"
        );
        // The message has to tell the reader what to do about it.
        let shown = error.to_string();
        assert!(shown.contains("Reload"), "{shown}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_write_we_never_made_is_never_ours() {
        let state = WatchState::default();
        assert!(!state.is_our_write(Path::new("/r/never-written.md")));
    }

    fn event(paths: &[&str]) -> notify::Event {
        notify::Event {
            kind: notify::EventKind::Modify(notify::event::ModifyKind::Any),
            paths: paths.iter().map(PathBuf::from).collect(),
            attrs: Default::default(),
        }
    }

    fn open(paths: &[&str]) -> Vec<PathBuf> {
        paths.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn classify_reports_the_open_document_separately_from_the_tree() {
        let documents = open(&["/r/open.md"]);

        let (docs, tree) = classify(&[event(&["/r/open.md"])], &documents);
        assert!(!docs.is_empty() && !tree, "editing an open file reloads it");

        let (docs, tree) = classify(&[event(&["/r/other.md"])], &documents);
        assert!(
            docs.is_empty() && tree,
            "another markdown file is a tree change"
        );
    }

    #[test]
    fn classify_reports_every_open_tab_that_changed() {
        // A background tab must live-reload too, which is the whole reason the
        // watch set is a list rather than one path.
        let documents = open(&["/r/a.md", "/r/b.md", "/r/c.md"]);
        let (docs, tree) = classify(&[event(&["/r/a.md", "/r/c.md"])], &documents);
        assert_eq!(docs, open(&["/r/a.md", "/r/c.md"]));
        assert!(!tree);
    }

    #[test]
    fn classify_ignores_unrelated_files() {
        // A `.png`, not a `.txt`: plain text is openable now, so it appears in the
        // tree and a new one there *is* a tree change. This test needs a file the
        // app genuinely cannot open to still mean what it meant.
        let (docs, tree) = classify(&[event(&["/r/diagram.png"])], &open(&["/r/open.md"]));
        assert!(docs.is_empty() && !tree);
    }

    #[test]
    fn classify_treats_a_new_plain_text_file_as_a_tree_change() {
        let (docs, tree) = classify(&[event(&["/r/notes.txt"])], &open(&["/r/open.md"]));
        assert!(docs.is_empty(), "it is not an open document");
        assert!(tree, "but the tree lists it, so the tree has to refresh");
    }

    #[test]
    fn classify_coalesces_a_save_burst_into_one_document_change() {
        let documents = open(&["/r/open.md"]);
        let burst = vec![
            event(&["/r/open.md"]),
            event(&["/r/open.md"]),
            event(&["/r/open.md"]),
        ];
        // One reload per file per batch, however noisy the editor's save was.
        assert_eq!(classify(&burst, &documents), (open(&["/r/open.md"]), false));
    }
}
