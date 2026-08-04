//! Opening a document the OS handed us.
//!
//! Registering as a `.md` handler (see `fileAssociations` in tauri.conf.json)
//! means "Open with → lindo-md" and double-clicking a file both launch the app
//! with a path in `argv`. A second launch while the app is already running is
//! routed to the running window by the single-instance plugin instead of opening
//! a second one — a viewer with four copies of itself on the taskbar is a bug,
//! not a feature.

use std::path::PathBuf;

use crate::files;

/// Picks the document out of a process argument list.
///
/// Split from `initial_document` so it is testable: the shapes that matter are a
/// bare launch, a launch with flags Tauri or the OS added, and a launch with a
/// path that is not Markdown at all.
pub fn document_from_args<I, S>(args: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        // `skip(1)` would be wrong for the single-instance callback, which
        // passes the full argv of the *second* process; filtering by shape
        // handles both callers.
        .filter(|arg| !arg.as_ref().starts_with('-'))
        .map(|arg| PathBuf::from(arg.as_ref()))
        .find(|path| files::is_markdown(path) && path.is_file())
}

/// The document this process was launched with, if any.
pub fn initial_document() -> Option<PathBuf> {
    document_from_args(std::env::args().skip(1))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let dir = std::env::temp_dir().join("lindo-md-assoc-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("doc.md");
        std::fs::write(&path, "# Hi").unwrap();

        let found = document_from_args(["--flag", "not-a-file.md", path.to_str().unwrap()]);
        assert_eq!(found, Some(path.clone()));

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn returns_nothing_for_a_bare_launch() {
        assert_eq!(document_from_args(Vec::<String>::new()), None);
    }
}
