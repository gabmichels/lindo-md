//! Opening a document the OS handed us.
//!
//! Registering as a `.md` handler (see `fileAssociations` in tauri.conf.json)
//! means "Open with → lindo-md" and double-clicking a file both reach the app.
//! *How* they reach it is three different mechanisms, not three spellings of
//! one, and the app has to be listening on all three:
//!
//! - **argv.** Windows and Linux launch the handler with the path on the command
//!   line. So does `lindo-md notes.md` from a shell, on every platform.
//! - **The single-instance plugin.** A second launch while the app is already
//!   running is routed into the running window rather than starting another one
//!   — a viewer with four copies of itself on the taskbar is a bug, not a
//!   feature. It hands over the full argv of that second process.
//! - **An Apple Event.** macOS puts the document in neither of the above. Finder
//!   sends `kAEOpenDocuments` to the process, which Tauri surfaces as
//!   `RunEvent::Opened`. It is also why single-instance never fires there: macOS
//!   will not start a second copy of a bundle, it reactivates the running one and
//!   sends it the event. With only the argv route wired up, a double-clicked file
//!   on macOS raised the window and opened nothing at all.
//!
//! Drag and drop is a fourth route, but it belongs to the webview rather than to
//! the process, so it is handled in the frontend — see `useFileDrop`.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
// Only the Apple Event route speaks in URLs, and it exists on one platform.
#[cfg(target_os = "macos")]
use tauri::Url;

use crate::files;

/// Documents the OS has handed us that the window has not collected yet.
///
/// This exists because the hand-off and the frontend asking for it race, in both
/// directions: a cold launch from Finder delivers the Apple Event before React
/// has mounted, and a double-click into an already-running app delivers it long
/// after. Neither a plain event nor a plain "what was I launched with?" call
/// covers both orders, so `deliver` does both — queue *and* event.
///
/// Delivering the same path twice is harmless by construction: `tabs/model.ts`
/// never opens one file in two tabs, so the second delivery just focuses the tab
/// the first one made.
#[derive(Default)]
pub struct OpenQueue(Mutex<Vec<PathBuf>>);

impl OpenQueue {
    /// A queue already holding the launch argument, if this process was given
    /// one — the argv route and every later hand-off then share one collection
    /// point, and the frontend has no ordering rule to get right between them.
    ///
    /// Seeded at construction rather than from `setup`, because the builder runs
    /// this before the webview exists and `setup` does not: `setup` and the
    /// invoke handler are on different threads, so a `setup` seed would race the
    /// frontend's first call. It only ever won that race by a wide margin, which
    /// is the kind of correctness that holds until a slower machine says no.
    pub fn from_launch() -> Self {
        let queue = Self::default();
        queue.push(initial_document());
        queue
    }

    fn push(&self, paths: impl IntoIterator<Item = PathBuf>) {
        self.lock().extend(paths);
    }

    fn take(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.lock())
    }

    /// A poisoned lock would mean dropping a document the reader asked for, which
    /// is worse than the inconsistency poisoning warns about — and there is none
    /// to warn about here, since the guarded value is a plain `Vec`.
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<PathBuf>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Picks the document out of a process argument list.
///
/// Split from `initial_document` so it is testable: the shapes that matter are a
/// bare launch, a launch with flags Tauri or the OS added, and a launch with a
/// path that is not Markdown at all.
///
/// Takes anything that is already a path rather than `AsRef<str>`, so the caller
/// can hand it `OsString`s — see `initial_document` for why that matters.
pub fn document_from_args<I, S>(args: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: Into<PathBuf>,
{
    args.into_iter()
        .map(Into::into)
        // `skip(1)` would be wrong for the single-instance callback, which
        // passes the full argv of the *second* process; filtering by shape
        // handles both callers. It also drops the `-psn_0_…` process serial
        // number macOS appends when Finder launches a bundle.
        .filter(|path: &PathBuf| !path.to_string_lossy().starts_with('-'))
        .find(|path| files::is_markdown(path) && path.is_file())
}

/// Picks the documents out of an `openURLs:` hand-off.
///
/// A list rather than an `Option` because this is the one route that can carry
/// several: selecting three files in Finder and pressing return sends *one*
/// event with three URLs, where "Open with" on Windows would launch three
/// processes with one argument each.
///
/// `Url::to_file_path` is what does the percent-decoding, so a document called
/// `My Notes.md` arrives as a path and not as `My%20Notes.md`.
///
/// Compiled only on macOS, because its one call site is: leaving it in place
/// everywhere makes it dead code, and `-D warnings` turns that into a failed
/// build on the two platforms this cannot be tested from.
#[cfg(target_os = "macos")]
pub fn documents_from_urls<'a, I>(urls: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = &'a Url>,
{
    urls.into_iter()
        // Anything that is not a local file — a custom scheme, an http URL — is
        // not something a viewer of local Markdown can open.
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| files::is_markdown(path) && path.is_file())
        .collect()
}

/// The document this process was launched with, if any.
pub fn initial_document() -> Option<PathBuf> {
    // `args_os`, not `args`: the latter panics on an argument that is not valid
    // Unicode, and a filename that is not valid Unicode is ordinary on Linux.
    // This runs while the builder is assembling, before any window exists, so
    // that panic would be a launch producing no window at all — the whole app
    // lost to one oddly-named file being dragged onto its icon.
    document_from_args(std::env::args_os().skip(1))
}

/// Hands documents to the window by both routes at once — see [`OpenQueue`].
pub fn deliver<I>(app: &AppHandle, paths: I)
where
    I: IntoIterator<Item = PathBuf>,
{
    let paths: Vec<PathBuf> = paths.into_iter().collect();
    if paths.is_empty() {
        return;
    }

    app.state::<OpenQueue>().push(paths.clone());
    for path in paths {
        let _ = app.emit("open-document", path.display().to_string());
    }
}

/// Everything the OS has handed us that the window has not collected yet.
/// Draining is the point: each document is opened once per hand-off.
pub fn take_pending(app: &AppHandle) -> Vec<PathBuf> {
    app.state::<OpenQueue>().take()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real Markdown file, since both pickers deliberately require one to
    /// exist on disk before they will hand it to the window.
    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("lindo-md-assoc-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, "# Hi").unwrap();
        path
    }

    #[test]
    fn ignores_flags_and_the_executable_path() {
        // Nothing here is an existing file, so nothing should be picked — the
        // point is that no flag is mistaken for a path.
        assert_eq!(
            document_from_args(["--flag", "-v", "--another=value"]),
            None
        );
    }

    #[test]
    fn ignores_a_path_that_is_not_markdown() {
        assert_eq!(document_from_args(["C:\\notes.txt", "/etc/passwd"]), None);
    }

    #[test]
    fn finds_a_real_markdown_file_among_the_arguments() {
        let path = fixture("doc.md");

        let found = document_from_args(["--flag", "not-a-file.md", path.to_str().unwrap()]);
        assert_eq!(found, Some(path.clone()));

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn returns_nothing_for_a_bare_launch() {
        assert_eq!(document_from_args(Vec::<String>::new()), None);
    }

    /// argv is read before the window exists, so anything that can panic there
    /// costs the whole launch rather than one document. `std::env::args` panics
    /// on exactly this input, which is why `initial_document` uses `args_os`.
    #[cfg(unix)]
    #[test]
    fn survives_an_argument_that_is_not_valid_unicode() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let path = fixture("valid.md");
        let invalid = OsString::from_vec(vec![0x66, 0x80, 0x6f, 0x2e, 0x6d, 0x64]);

        let found = document_from_args([invalid, path.clone().into_os_string()]);
        assert_eq!(found, Some(path.clone()));

        std::fs::remove_file(&path).ok();
    }

    /// The Apple Event route. Gated as a block rather than test by test because
    /// the function under test does not exist off macOS either.
    #[cfg(target_os = "macos")]
    mod apple_events {
        use super::*;

        #[test]
        fn reads_every_markdown_file_url_in_an_open_event() {
            let first = fixture("one.md");
            let second = fixture("two.md");

            let urls = [
                Url::from_file_path(&first).unwrap(),
                Url::from_file_path(&second).unwrap(),
            ];
            assert_eq!(
                documents_from_urls(urls.iter()),
                vec![first.clone(), second.clone()]
            );

            std::fs::remove_file(&first).ok();
            std::fs::remove_file(&second).ok();
        }

        #[test]
        fn decodes_a_percent_escaped_file_url() {
            // Finder sends `file:///…/My%20Notes.md`; opening that literally
            // fails with "no such file", which looks like a broken association.
            let path = fixture("My Notes.md");
            let url = Url::from_file_path(&path).unwrap();
            assert!(url.as_str().contains("%20"), "the fixture must be escaped");

            assert_eq!(documents_from_urls([&url]), vec![path.clone()]);

            std::fs::remove_file(&path).ok();
        }

        #[test]
        fn ignores_urls_that_are_not_local_markdown() {
            let text = fixture("notes.txt");
            let urls = [
                Url::parse("https://example.com/readme.md").unwrap(),
                Url::from_file_path(&text).unwrap(),
                Url::from_file_path(std::env::temp_dir().join("absent.md")).unwrap(),
            ];
            assert!(documents_from_urls(urls.iter()).is_empty());

            std::fs::remove_file(&text).ok();
        }
    }

    #[test]
    fn the_queue_hands_each_document_over_exactly_once() {
        let queue = OpenQueue::default();
        queue.push([PathBuf::from("a.md")]);
        queue.push([PathBuf::from("b.md")]);

        assert_eq!(
            queue.take(),
            vec![PathBuf::from("a.md"), PathBuf::from("b.md")]
        );
        // A frontend that asks again — a reload, say — must not reopen them.
        assert!(queue.take().is_empty());
    }
}
