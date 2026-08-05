//! Reading and writing the files a user picks in a save/open dialog: exported
//! themes and exported documents.
//!
//! **These commands take a path from the webview, and the webview is untrusted.**
//! The previous version of this comment claimed each one "accepts a single path that
//! came from an OS dialog the user just interacted with". That is a claim about the
//! *caller*, and nothing here can check it: the dialog is shown by TypeScript
//! (`SettingsDrawer.tsx`, `App.tsx`), which is the side AGENTS.md declares untrusted.
//! It also claimed `read_theme` "cannot be used to read `id_rsa`" — true of that one
//! filename, and false of the class. Plenty of secrets are `.json`: gcloud's
//! application-default credentials, `Code/User/settings.json`, `.npmrc`'s successors.
//!
//! So the extension check is a guard against a *mistake*, not a security boundary. It
//! stops `write_theme` writing a `.ps1`; it does not stop it writing a `.json` that
//! something else executes.
//!
//! What this module does guarantee, and what the checks below enforce:
//!
//! - the path is absolute, so nothing resolves against the process's working directory
//! - it is not a UNC/network path, so a write cannot be turned into an outbound SMB
//!   connection (which on Windows offers NTLM credentials to whoever is listening)
//! - the final component is not a symlink or reparse point, so a write cannot be
//!   redirected through a link the app never looked at
//! - a write refuses anything that already exists and is not a regular file
//!
//! Reaching any of this still requires code execution in the webview, which needs both
//! an ammonia bypass and a CSP bypass. This is defence in depth. The real fix is for
//! the path never to cross IPC at all — see the note at the bottom of this file.

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

/// True for a Windows path that resolves over the network rather than on this machine.
///
/// `\\server\share\x` and the extended-length `\\?\UNC\server\share\x` both do.
/// `\\?\C:\x` does not — it is an ordinary local path in the form that escapes the
/// 260-character limit.
///
/// Worth blocking on a write in particular: Windows will authenticate to the far end
/// to satisfy it, which hands an NTLM exchange to whoever is listening.
#[cfg(windows)]
fn is_network_path(path: &Path) -> bool {
    let text: String = path
        .as_os_str()
        .to_string_lossy()
        .chars()
        .map(|c| if c == '/' { '\\' } else { c })
        .collect();

    if text.to_uppercase().starts_with(r"\\?\UNC\") {
        return true;
    }
    text.starts_with(r"\\") && !text.starts_with(r"\\?\")
}

/// No UNC equivalent exists off Windows; a leading `//` there is an ordinary local path.
#[cfg(not(windows))]
fn is_network_path(_path: &Path) -> bool {
    false
}

/// The checks the extension test is not. See the module doc for what each one buys.
fn require_safe_target(path: &Path, for_writing: bool) -> LindoResult<()> {
    if !path.is_absolute() {
        return Err(LindoError::msg(format!(
            "{} is not an absolute path",
            path.display()
        )));
    }
    if is_network_path(path) {
        return Err(LindoError::msg(format!(
            "{} is a network path; exports are written locally",
            path.display()
        )));
    }

    // `symlink_metadata` deliberately does not follow the link — the question is what
    // this name *is*, not what it points at. A missing file is fine for a write and
    // will fail later, informatively, for a read.
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(LindoError::msg(format!(
                "{} is a link; exports are written to real files",
                path.display()
            )));
        }
        if for_writing && !file_type.is_file() {
            return Err(LindoError::msg(format!(
                "{} already exists and is not a regular file",
                path.display()
            )));
        }
    }

    Ok(())
}

pub fn read_theme(path: &Path) -> LindoResult<String> {
    require_extension(path, &["json"])?;
    require_safe_target(path, false)?;

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
    require_safe_target(path, true)?;
    write(path, contents)
}

pub fn write_html(path: &Path, contents: &str) -> LindoResult<()> {
    require_extension(path, &["html", "htm"])?;
    require_safe_target(path, true)?;
    write(path, contents)
}

fn write(path: &Path, contents: &str) -> LindoResult<()> {
    std::fs::write(path, contents).map_err(|source| LindoError::WriteFile {
        path: path.display().to_string(),
        source,
    })
}

// The real fix, deliberately not done here
// ----------------------------------------
//
// Everything above narrows an arbitrary-path primitive. It does not remove one. A
// caller that can reach `invoke` still chooses the path, and the checks only decide
// which paths are refused.
//
// The shape that removes it: show the dialog in Rust and never accept a path over IPC
// at all. `tauri-plugin-dialog` has a Rust API, so `export_theme(contents)` would open
// the save dialog itself, write to whatever the *user* picked, and return the path for
// the status line. There are three call sites — `SettingsDrawer.tsx` twice and
// `App.tsx` once — and each gets simpler, because the dialog and the write stop being
// two steps the frontend has to keep in agreement.
//
// It is not done in this commit because it changes three working user-facing flows and
// a native file dialog cannot be driven by the CDP harness this repo uses to check
// itself. Shipping an unverifiable rewrite of a working flow, to close a hole that
// needs both an ammonia bypass and a CSP bypass to reach, is the wrong order to do
// things in. It wants its own change, with someone clicking through all three dialogs.

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

    // --- the checks the extension test is not -----------------------------

    #[test]
    fn refuses_a_relative_path() {
        // Nothing may resolve against the process's working directory, which the
        // webview has no business influencing.
        assert!(require_safe_target(Path::new("theme.json"), true).is_err());
        assert!(require_safe_target(Path::new("../../theme.json"), true).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn refuses_a_unc_path_but_allows_the_extended_length_local_form() {
        assert!(is_network_path(Path::new(r"\\attacker\share\theme.json")));
        assert!(is_network_path(Path::new(
            r"\\?\UNC\attacker\share\theme.json"
        )));
        assert!(is_network_path(Path::new(r"//attacker/share/theme.json")));

        // `\\?\C:\...` is local — it is the form that escapes the 260-char limit.
        assert!(!is_network_path(Path::new(r"\\?\C:\Users\me\theme.json")));
        assert!(!is_network_path(Path::new(r"C:\Users\me\theme.json")));
    }

    #[cfg(windows)]
    #[test]
    fn a_unc_write_is_refused_before_any_connection_is_attempted() {
        // The error must come from our own check: reaching the filesystem would
        // already have offered credentials to whoever answered.
        let error = write_theme(Path::new(r"\\attacker\share\x.json"), "{}")
            .unwrap_err()
            .to_string();
        assert!(error.contains("network path"), "{error}");
    }

    #[test]
    fn refuses_to_write_over_a_directory() {
        let dir = std::env::temp_dir().join("lindo-md-export-dir-test.json");
        std::fs::create_dir_all(&dir).unwrap();

        let error = write_theme(&dir, "{}").unwrap_err().to_string();
        assert!(error.contains("not a regular file"), "{error}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_ordinary_absolute_path_still_passes_every_check() {
        let dir = std::env::temp_dir().join("lindo-md-export-ok-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("theme.json");

        // Both for a file that does not exist yet and one that does.
        assert!(require_safe_target(&path, true).is_ok());
        write_theme(&path, "{}").unwrap();
        assert!(require_safe_target(&path, true).is_ok());
        assert!(require_safe_target(&path, false).is_ok());

        std::fs::remove_dir_all(&dir).ok();
    }
}
