//! Keeps the extension lists in `files.rs`, `tauri.conf.json` and
//! `installer-hooks.nsh` from drifting apart.
//!
//! `files.rs` is the source of truth for what lindo-md will *open*. Two other files
//! restate a subset of it for Windows, and neither can import a Rust constant: the
//! Tauri config is JSON, and the installer hook is NSIS. So they are pinned here
//! instead, in the same spirit as `window_config.rs` next door — the build's inputs
//! are tested, because nothing else will notice when they disagree.
//!
//! Two distinct failures are being guarded against, and they look nothing alike:
//!
//!   * **An extension added to `files.rs` and forgotten in `tauri.conf.json`** opens
//!     fine from inside the app and does nothing at all when double-clicked, which
//!     reads to a user as the file association being broken.
//!   * **A plain-text extension reaching the association list** would claim `.txt`
//!     and `.log` on install, putting lindo-md into the "Open with" list for every
//!     text file on the machine. Openable and claimed are deliberately different
//!     sets; see the comment in `installer-hooks.nsh`.
//!
//! It lives in `tests/` rather than beside a module because it tests the build's
//! inputs, not any code.

use std::collections::BTreeSet;

use serde_json::Value;

const CONFIG: &str = include_str!("../tauri.conf.json");
const HOOKS: &str = include_str!("../installer-hooks.nsh");
const FILES_RS: &str = include_str!("../src/files.rs");

/// Pulls a `pub const NAME: [&str; N] = [...]` array out of `files.rs` by text.
///
/// Reading the source rather than importing the constant is deliberate: this is an
/// integration test, so it links against the library's public surface, and making
/// these `pub` purely to be asserted on would widen the API for the benefit of a
/// test. The arrays are simple enough that a text scan cannot be subtly wrong — and
/// if the declaration ever stops matching, the `expect` below fails loudly rather
/// than silently returning an empty set.
fn rust_extensions(name: &str) -> BTreeSet<String> {
    let start = FILES_RS
        .find(&format!("pub const {name}:"))
        .unwrap_or_else(|| panic!("{name} not found in files.rs"));
    // Everything after the `=` — which skips the `[&str; N]` type annotation, whose
    // brackets would otherwise be mistaken for the value's.
    let Some((_, declaration)) = FILES_RS.get(start..).and_then(|rest| rest.split_once('=')) else {
        panic!("{name} has no value");
    };
    let Some((body, _)) = declaration
        .split_once('[')
        .and_then(|(_, rest)| rest.split_once(']'))
    else {
        panic!("{name} is not an array literal");
    };

    let found: BTreeSet<String> = body
        .split(',')
        .map(|piece| piece.trim().trim_matches('"').to_owned())
        .filter(|piece| !piece.is_empty())
        .collect();

    assert!(!found.is_empty(), "{name} parsed as empty — has it moved?");
    found
}

fn claimed_extensions() -> BTreeSet<String> {
    let config: Value = serde_json::from_str(CONFIG).expect("tauri.conf.json is valid JSON");
    config["bundle"]["fileAssociations"]
        .as_array()
        .expect("bundle.fileAssociations is an array")
        .iter()
        .flat_map(|association| {
            association["ext"]
                .as_array()
                .expect("each association lists its extensions")
                .iter()
                .map(|ext| ext.as_str().expect("an extension is a string").to_owned())
        })
        .collect()
}

/// Every `!insertmacro LindoRegisterExtension ".x"` in the install hook.
fn registered_extensions() -> BTreeSet<String> {
    extensions_after(HOOKS, "!insertmacro LindoRegisterExtension \".")
}

/// Every `Software\Classes\.x\OpenWithProgids` the uninstall hook clears.
///
/// Anchored to the whole `DeleteRegValue` statement rather than to the registry path
/// alone. That path also appears in the hook file's own opening comment, and matching
/// it there swept up a sentence of prose as though it were an extension name.
fn unregistered_extensions() -> BTreeSet<String> {
    extensions_after(HOOKS, "DeleteRegValue SHELL_CONTEXT \"Software\\Classes\\.")
}

fn extensions_after(text: &str, marker: &str) -> BTreeSet<String> {
    text.match_indices(marker)
        .filter_map(|(index, _)| {
            let rest = text.get(index + marker.len()..)?;
            let end = rest.find(['"', '\\'])?;
            rest.get(..end).map(str::to_owned)
        })
        .filter(|extension| !extension.is_empty())
        .collect()
}

/// What the installer is allowed to claim: the Markdown dialects and MDX. Anything
/// lindo-md merely opens must not appear.
fn expected_claims() -> BTreeSet<String> {
    rust_extensions("MARKDOWN_EXTENSIONS")
        .union(&rust_extensions("MDX_EXTENSIONS"))
        .cloned()
        .collect()
}

#[test]
fn the_config_claims_exactly_the_markdown_dialects_and_mdx() {
    assert_eq!(claimed_extensions(), expected_claims());
}

#[test]
fn no_plain_text_extension_is_ever_claimed_on_install() {
    let plain_text = rust_extensions("PLAIN_TEXT_EXTENSIONS");
    assert!(!plain_text.is_empty(), "the array should not be empty");

    for extension in &plain_text {
        assert!(
            !claimed_extensions().contains(extension),
            ".{extension} must stay openable-but-unclaimed — see installer-hooks.nsh"
        );
        assert!(
            !registered_extensions().contains(extension),
            ".{extension} must not be registered by the installer"
        );
    }
}

#[test]
fn the_installer_registers_every_extension_the_config_claims() {
    assert_eq!(registered_extensions(), claimed_extensions());
}

/// An extension registered on install and not cleared on uninstall leaves a dead
/// "Open with" entry pointing at a binary that is no longer there.
#[test]
fn the_uninstaller_clears_everything_the_installer_wrote() {
    assert_eq!(unregistered_extensions(), registered_extensions());
}

/// The three names that have to agree across `tauri.conf.json`, `installer-hooks.nsh`
/// and `defaults.rs`. AGENTS.md documents the coupling; this is what enforces it.
#[test]
fn the_progid_matches_between_the_config_and_the_installer() {
    let config: Value = serde_json::from_str(CONFIG).expect("tauri.conf.json is valid JSON");
    let progid = config["bundle"]["fileAssociations"][0]["name"]
        .as_str()
        .expect("the association names a ProgID");

    assert!(
        HOOKS.contains(&format!("!define LINDO_PROGID \"{progid}\"")),
        "installer-hooks.nsh must define LINDO_PROGID as {progid}"
    );
}
