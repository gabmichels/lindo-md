//! Which application owns `.md`, and the only supported way to change it.
//!
//! Windows does not let an application make itself the default handler. Since
//! KB5034765 the `UserChoice` key is hash-protected and enforced by a kernel
//! driver (UCPD.sys); a write from anywhere but the Settings UI is rejected, and
//! forging the hash is what malware does. So this module does the two things
//! that *are* allowed:
//!
//!   * **Read** the current association, so the UI can say "currently opened by
//!     Visual Studio Code" instead of showing a button that might do nothing.
//!   * **Deep-link** into Settings at our own entry, so the user's click is one
//!     click rather than a hunt through a list of every installed app.
//!
//! The deep link only resolves because the installer registers us under
//! `RegisteredApplications` — see `src-tauri/installer-hooks.nsh`. Tauri's own
//! `fileAssociations` handling writes the ProgID but not the `Capabilities` key
//! that Settings enumerates, which is why that hook exists.

use serde::Serialize;
use tauri::AppHandle;

use crate::error::{LindoError, LindoResult};

/// Must match `bundle.fileAssociations[].name` in `tauri.conf.json`.
#[cfg(windows)]
const PROGID: &str = "LindoMd.Markdown";

/// Must match the value name written under `Software\RegisteredApplications` by
/// `installer-hooks.nsh`, and is what the `ms-settings` deep link looks up.
#[cfg(windows)]
const REGISTERED_APP: &str = "lindo-md";

/// The extension the settings row talks about. The installer claims the other
/// three too, but a row that named all four would be a paragraph, and in
/// practice `.md` is the one that decides whether double-clicking works.
#[cfg(windows)]
const PRIMARY_EXTENSION: &str = ".md";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAppStatus {
    /// Whether this platform can be inspected and asked at all. False everywhere
    /// but Windows today, which is what hides the row rather than showing a
    /// control that cannot work.
    pub supported: bool,
    pub is_default: bool,
    /// Friendly name of whatever currently opens `.md`, when it is not us and we
    /// could work out a name worth showing.
    pub current_handler: Option<String>,
}

#[cfg(not(windows))]
impl DefaultAppStatus {
    fn unsupported() -> Self {
        Self {
            supported: false,
            is_default: false,
            current_handler: None,
        }
    }
}

#[cfg(not(windows))]
pub fn status() -> DefaultAppStatus {
    DefaultAppStatus::unsupported()
}

#[cfg(not(windows))]
pub fn request_default(_app: &AppHandle) -> LindoResult<()> {
    Err(LindoError::msg(
        "Setting the default Markdown application from inside lindo-md is only \
         supported on Windows. Use your system settings to change it.",
    ))
}

#[cfg(windows)]
pub fn status() -> DefaultAppStatus {
    let progid = current_progid(PRIMARY_EXTENSION);
    let is_default = progid.as_deref() == Some(PROGID);

    DefaultAppStatus {
        supported: true,
        is_default,
        // Naming ourselves back to the user in the "not default" line would be
        // nonsense, so the name is only resolved when someone else holds it.
        current_handler: if is_default {
            None
        } else {
            progid.as_deref().and_then(friendly_name)
        },
    }
}

/// Opens Settings at lindo-md's own default-apps page.
///
/// The `registeredAppUser` form needs Windows 11 21H2 with the 2023-04 update or
/// later. On anything older the query string is not understood, so the bare page
/// is opened instead — one extra scroll for the user, rather than a dead button.
#[cfg(windows)]
pub fn request_default(app: &AppHandle) -> LindoResult<()> {
    use tauri_plugin_opener::OpenerExt;

    let deep_link = format!("ms-settings:defaultapps?registeredAppUser={REGISTERED_APP}");

    app.opener()
        .open_url(deep_link, None::<&str>)
        .or_else(|_| {
            app.opener()
                .open_url("ms-settings:defaultapps", None::<&str>)
        })
        .map_err(|e| {
            LindoError::msg(format!(
                "Could not open Windows Settings: {e}. You can change this under \
                 Settings → Apps → Default apps."
            ))
        })
}

/// The ProgID that currently opens `extension`.
///
/// `UserChoice` is what Explorer actually honours and it wins outright, so it is
/// checked first. Only when the user has never picked a handler does the class
/// registration underneath it decide — which is the case where our installer's
/// own write is what takes effect.
#[cfg(windows)]
fn current_progid(extension: &str) -> Option<String> {
    let user_choice = format!(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\{extension}\\UserChoice"
    );

    read_string(windows_registry::CURRENT_USER, &user_choice, "ProgId")
        .or_else(|| {
            read_string(
                windows_registry::CURRENT_USER,
                &format!("Software\\Classes\\{extension}"),
                "",
            )
        })
        .or_else(|| read_string(windows_registry::CLASSES_ROOT, extension, ""))
        .filter(|progid| !progid.is_empty())
}

/// A name for a ProgID that is worth showing a human.
///
/// The order matters more than it looks. A ProgID's *default value* is by
/// convention the file type, not the application — VS Code's `VSCode.md` reads
/// "Markdown Source File" — so answering "Markdown files currently open in
/// Markdown Source File" is what happens if it is trusted first. The executable
/// behind the open command names an application, so it is preferred, and the
/// type description is kept only as a last resort before the raw ProgID.
///
/// Anything that comes back as an unresolved MUI reference (`@shell32.dll,-1234`)
/// is skipped: resolving one needs `SHLoadIndirectString`, and every answer below
/// is better than a resource id.
#[cfg(windows)]
fn friendly_name(progid: &str) -> Option<String> {
    let application = read_string(
        windows_registry::CLASSES_ROOT,
        &format!("{progid}\\Application"),
        "ApplicationName",
    )
    .filter(|name| is_displayable(name));

    let executable = executable_name(progid).map(|file_name| {
        name_for_executable(&file_name)
            .map(str::to_string)
            .unwrap_or(file_name)
    });

    let description =
        read_string(windows_registry::CLASSES_ROOT, progid, "").filter(|name| is_displayable(name));

    application
        .or(executable)
        .or(description)
        .or_else(|| Some(progid.to_string()))
}

#[cfg(windows)]
fn is_displayable(name: &str) -> bool {
    !name.trim().is_empty() && !name.starts_with('@')
}

/// Executables we can put a name to.
///
/// The registry answers "which application owns `.md`" with a ProgID whose only
/// human-readable value is the *file type*, so the executable behind it is what
/// actually names an application. This turns the ones a reader is likely to meet
/// into the name they know; anything absent falls back to the file name, which is
/// still an application rather than a file format.
#[cfg(windows)]
const KNOWN_EXECUTABLES: [(&str, &str); 7] = [
    ("code.exe", "Visual Studio Code"),
    ("obsidian.exe", "Obsidian"),
    ("notepad++.exe", "Notepad++"),
    ("sublime_text.exe", "Sublime Text"),
    ("typora.exe", "Typora"),
    ("notepad.exe", "Notepad"),
    ("marktext.exe", "Mark Text"),
];

#[cfg(windows)]
fn name_for_executable(file_name: &str) -> Option<&'static str> {
    let needle = file_name.to_lowercase();
    KNOWN_EXECUTABLES
        .iter()
        .find(|(executable, _)| *executable == needle)
        .map(|(_, name)| *name)
}

/// The executable file name out of a ProgID's open command, e.g.
/// `"C:\...\Code.exe" "%1"` → `Code.exe`.
#[cfg(windows)]
fn executable_name(progid: &str) -> Option<String> {
    let command = read_string(
        windows_registry::CLASSES_ROOT,
        &format!("{progid}\\shell\\open\\command"),
        "",
    )?;
    executable_from_command(&command)
}

/// Split out from the registry read so the quoting cases are testable: the value
/// may or may not quote the path, and always has arguments after it.
#[cfg(windows)]
fn executable_from_command(command: &str) -> Option<String> {
    let command = command.trim();

    let path = if let Some(rest) = command.strip_prefix('"') {
        rest.split('"').next()?
    } else {
        // Unquoted values cannot contain a space in the path without being
        // ambiguous, so the first token is the executable.
        command.split_whitespace().next()?
    };

    std::path::Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
}

#[cfg(windows)]
fn read_string(root: &windows_registry::Key, path: &str, name: &str) -> Option<String> {
    root.open(path).ok()?.get_string(name).ok()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn executable_is_taken_from_a_quoted_command() {
        assert_eq!(
            executable_from_command(r#""C:\Program Files\App\Code.exe" "%1""#),
            Some("Code.exe".to_string())
        );
    }

    #[test]
    fn executable_is_taken_from_an_unquoted_command() {
        assert_eq!(
            executable_from_command(r"C:\Windows\notepad.exe %1"),
            Some("notepad.exe".to_string())
        );
    }

    #[test]
    fn a_command_with_no_path_yields_nothing() {
        assert_eq!(executable_from_command("   "), None);
    }

    #[test]
    fn known_executables_are_matched_case_insensitively() {
        assert_eq!(name_for_executable("Code.exe"), Some("Visual Studio Code"));
        assert_eq!(name_for_executable("NOTEPAD.EXE"), Some("Notepad"));
        assert_eq!(name_for_executable("something-else.exe"), None);
    }

    #[test]
    fn mui_references_are_not_shown_to_the_user() {
        assert!(!is_displayable(
            "@%SystemRoot%\\system32\\shell32.dll,-1234"
        ));
        assert!(!is_displayable("  "));
        assert!(is_displayable("Visual Studio Code"));
    }

    /// Reading the association must never panic or block, whatever the machine's
    /// registry looks like — the settings dialog calls this on every open.
    #[test]
    fn status_is_readable_on_this_machine() {
        let status = status();
        assert!(status.supported);
    }
}
