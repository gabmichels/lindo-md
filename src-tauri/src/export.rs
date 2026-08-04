//! Reading and writing the files a user picks in a save/open dialog: exported
//! themes and exported documents.
//!
//! The webview has no filesystem permission, and these commands are not a way
//! around that. Each one accepts a single path that came from an OS dialog the
//! user just interacted with, and refuses any extension other than the one its
//! purpose implies — so `write_theme` cannot be talked into writing a `.ps1`,
//! and `read_theme` cannot be used to read `id_rsa`.

use std::path::Path;

use crate::error::{LindoError, LindoResult};

/// Cap on a theme file. A theme is a few kilobytes of JSON; anything at this
/// size is not one, and parsing it would only waste the user's time.
const MAX_THEME_BYTES: u64 = 1024 * 1024;

fn require_extension(path: &Path, expected: &[&str]) -> LindoResult<()> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();

    if expected.contains(&extension.as_str()) {
        return Ok(());
    }
    Err(LindoError::msg(format!(
        "{} does not end in {}",
        path.display(),
        expected
            .iter()
            .map(|e| format!(".{e}"))
            .collect::<Vec<_>>()
            .join(" or ")
    )))
}

pub fn read_theme(path: &Path) -> LindoResult<String> {
    require_extension(path, &["json"])?;

    let size = std::fs::metadata(path)
        .map_err(|source| LindoError::ReadFile {
            path: path.display().to_string(),
            source,
        })?
        .len();
    if size > MAX_THEME_BYTES {
        return Err(LindoError::msg(format!(
            "{} is too large to be a theme file",
            path.display()
        )));
    }

    std::fs::read_to_string(path).map_err(|source| LindoError::ReadFile {
        path: path.display().to_string(),
        source,
    })
}

pub fn write_theme(path: &Path, contents: &str) -> LindoResult<()> {
    require_extension(path, &["json"])?;
    write(path, contents)
}

pub fn write_html(path: &Path, contents: &str) -> LindoResult<()> {
    require_extension(path, &["html", "htm"])?;
    write(path, contents)
}

fn write(path: &Path, contents: &str) -> LindoResult<()> {
    std::fs::write(path, contents).map_err(|source| LindoError::WriteFile {
        path: path.display().to_string(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_extension_it_is_for() {
        assert!(require_extension(Path::new("a.json"), &["json"]).is_ok());
        assert!(require_extension(Path::new("a.JSON"), &["json"]).is_ok());
        assert!(require_extension(Path::new("a.html"), &["html", "htm"]).is_ok());
    }

    #[test]
    fn refuses_anything_else() {
        // The point of the guard: a path from a dialog is user-chosen, but the
        // command must still not be a general-purpose file writer.
        for path in ["a.ps1", "a.exe", "id_rsa", "a.json.txt", "a"] {
            assert!(
                require_extension(Path::new(path), &["json"]).is_err(),
                "{path} should be refused"
            );
        }
    }

    #[test]
    fn the_error_names_the_expected_extensions() {
        let error = require_extension(Path::new("a.txt"), &["html", "htm"])
            .unwrap_err()
            .to_string();
        assert!(error.contains(".html"), "{error}");
        assert!(error.contains(".htm"), "{error}");
    }

    #[test]
    fn round_trips_a_theme_through_a_temp_file() {
        let dir = std::env::temp_dir().join("lindo-md-export-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("theme.json");

        write_theme(&path, r#"{"format":"lindo-md-theme"}"#).unwrap();
        assert_eq!(read_theme(&path).unwrap(), r#"{"format":"lindo-md-theme"}"#);

        std::fs::remove_file(&path).ok();
    }
}
