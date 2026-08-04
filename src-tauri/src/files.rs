//! Reading documents, scanning folders, and watching both for changes.
//!
//! This is the only module that touches the filesystem. The webview has no `fs`
//! permission at all, so every path that reaches disk arrives through one of the
//! commands here.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{PrettyError, PrettyResult};
use crate::markdown::{self, Heading};

pub const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn read(app: &AppHandle, path: &Path) -> PrettyResult<Document> {
    if !is_markdown(path) {
        return Err(PrettyError::UnsupportedFile(path.display().to_string()));
    }

    let source = std::fs::read_to_string(path).map_err(|source| PrettyError::ReadFile {
        path: path.display().to_string(),
        source,
    })?;

    let dir = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    // The asset protocol is deny-all by default (see tauri.conf.json). Granting
    // the document's own directory — and only that — is what lets `![](img/a.png)`
    // resolve, without giving the webview a window onto the whole disk.
    let _ = app.asset_protocol_scope().allow_directory(&dir, true);

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());

    let rendered = markdown::render(&source);
    let title = rendered.title.clone().unwrap_or_else(|| name.clone());

    Ok(Document {
        path: path.display().to_string(),
        dir: dir.display().to_string(),
        name,
        html: rendered.html,
        toc: rendered.toc,
        frontmatter: rendered.frontmatter,
        title,
    })
}

/// Builds the document tree for a folder. Directories containing no Markdown at
/// any depth are dropped, so opening a source repository shows the docs rather
/// than the source layout.
pub fn scan(root: &Path, respect_gitignore: bool) -> PrettyResult<Vec<TreeNode>> {
    if !root.is_dir() {
        return Err(PrettyError::msg(format!(
            "{} is not a folder",
            root.display()
        )));
    }

    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(true)
        .git_ignore(respect_gitignore)
        .git_global(respect_gitignore)
        .git_exclude(respect_gitignore)
        .parents(respect_gitignore)
        .max_depth(Some(MAX_DEPTH))
        .filter_entry(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|name| !SKIP_DIRS.contains(&name))
                .unwrap_or(true)
        });

    // Collect the markdown files first, then rebuild the directory structure from
    // their paths. Walking and pruning in one pass would need to look ahead to
    // know whether a directory contains anything worth keeping.
    let mut files: Vec<PathBuf> = builder
        .build()
        .filter_map(Result::ok)
        .map(|entry| entry.into_path())
        .filter(|path| path.is_file() && is_markdown(path))
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
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    leaves.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(leaves);
    dirs
}

/// Holds the live watcher. Replacing it drops the previous one, which is how a
/// watch is cancelled — `notify` has no "unwatch everything" call.
#[derive(Default)]
pub struct WatchState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// Watches the open document and, optionally, the open folder. Emits:
///
/// - `document-changed` with the path, when the open file's contents change
/// - `tree-changed`, when Markdown files appear or disappear in the folder
pub fn watch(
    app: &AppHandle,
    state: &WatchState,
    document: Option<PathBuf>,
    folder: Option<PathBuf>,
) -> PrettyResult<()> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            // A failed send only means the receiver thread is gone, which happens
            // when the watch is replaced; there is nothing to recover.
            let _ = tx.send(event);
        }
    })
    .map_err(|e| PrettyError::msg(format!("Could not start watching for changes: {e}")))?;

    // The file itself is watched through its parent directory: editors that save
    // by rename replace the inode, and a watch on the old one goes deaf.
    if let Some(parent) = document.as_deref().and_then(Path::parent) {
        watcher
            .watch(parent, RecursiveMode::NonRecursive)
            .map_err(|e| PrettyError::msg(format!("Could not watch {}: {e}", parent.display())))?;
    }
    if let Some(folder) = &folder {
        watcher
            .watch(folder, RecursiveMode::Recursive)
            .map_err(|e| PrettyError::msg(format!("Could not watch {}: {e}", folder.display())))?;
    }

    let handle = app.clone();
    std::thread::spawn(move || debounce_loop(handle, rx, document));

    // Dropping the previous watcher here also ends its receiver thread, because
    // the channel sender it held goes with it.
    *state
        .watcher
        .lock()
        .map_err(|_| PrettyError::msg("Watch state was poisoned"))? = Some(watcher);
    Ok(())
}

/// Coalesces a burst of filesystem events into at most one emit per kind.
/// Returns when the channel closes, i.e. when the watcher is dropped.
fn debounce_loop(
    app: AppHandle,
    rx: mpsc::Receiver<notify::Event>,
    document: Option<PathBuf>,
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

        let (document_changed, tree_changed) = classify(&batch, document.as_deref());
        if document_changed {
            if let Some(path) = &document {
                let _ = app.emit("document-changed", path.display().to_string());
            }
        }
        if tree_changed {
            let _ = app.emit("tree-changed", ());
        }
    }
}

/// Splits a batch of events into "the open document changed" and "the set of
/// documents changed". Split out from the loop so it can be tested without a
/// filesystem or a running app.
fn classify(events: &[notify::Event], document: Option<&Path>) -> (bool, bool) {
    let mut document_changed = false;
    let mut tree_changed = false;

    for event in events {
        for path in &event.paths {
            if Some(path.as_path()) == document {
                document_changed = true;
            } else if is_markdown(path) || path.extension().is_none() {
                // A path with no extension is most likely a directory being added
                // or removed; either way the tree needs a refresh.
                tree_changed = true;
            }
        }
    }

    (document_changed, tree_changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_markdown_extensions_case_insensitively() {
        for name in ["a.md", "a.MD", "a.markdown", "a.mdown", "a.mkd"] {
            assert!(is_markdown(Path::new(name)), "{name} should be markdown");
        }
        for name in ["a.txt", "a.mdx", "a.rs", "a"] {
            assert!(!is_markdown(Path::new(name)), "{name} should not be");
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

    fn event(paths: &[&str]) -> notify::Event {
        notify::Event {
            kind: notify::EventKind::Modify(notify::event::ModifyKind::Any),
            paths: paths.iter().map(PathBuf::from).collect(),
            attrs: Default::default(),
        }
    }

    #[test]
    fn classify_reports_the_open_document_separately_from_the_tree() {
        let open = PathBuf::from("/r/open.md");

        let (doc, tree) = classify(&[event(&["/r/open.md"])], Some(&open));
        assert!(doc && !tree, "editing the open file is a document change");

        let (doc, tree) = classify(&[event(&["/r/other.md"])], Some(&open));
        assert!(!doc && tree, "another markdown file is a tree change");
    }

    #[test]
    fn classify_ignores_unrelated_files() {
        let open = PathBuf::from("/r/open.md");
        let (doc, tree) = classify(&[event(&["/r/notes.txt"])], Some(&open));
        assert!(!doc && !tree);
    }

    #[test]
    fn classify_coalesces_a_save_burst_into_one_document_change() {
        let open = PathBuf::from("/r/open.md");
        let burst = vec![
            event(&["/r/open.md"]),
            event(&["/r/open.md"]),
            event(&["/r/open.md"]),
        ];
        // The point is the pair, not a count: the caller emits at most once per
        // kind per batch.
        assert_eq!(classify(&burst, Some(&open)), (true, false));
    }
}
