//! Every command is a thin adapter: argument shaping, then a call into the module
//! that owns the logic. Business rules live in `config.rs` / `markdown.rs` /
//! `files.rs` so they stay unit-testable without a running Tauri app.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::assoc;
use crate::config::{self, AppConfig};
use crate::defaults::{self, DefaultAppStatus};
use crate::error::LindoResult;
use crate::export;
use crate::files::{self, Document, ScanOptions, TreeNode, WatchState};
use crate::markdown::RenderOptions;

#[tauri::command]
pub fn get_config(app: AppHandle) -> LindoResult<AppConfig> {
    config::load(&app)
}

#[tauri::command]
pub fn set_config(app: AppHandle, config: AppConfig) -> LindoResult<()> {
    config::save(&app, &config)
}

#[tauri::command]
pub fn open_document(app: AppHandle, path: String) -> LindoResult<Document> {
    // Rendering settings are read here rather than passed in: they are the same
    // for every document, and a frontend that had to remember to send them would
    // eventually render one document by different rules than the last.
    let render_options = RenderOptions {
        smart_punctuation: config::load(&app)
            .map(|config| config.smart_punctuation)
            .unwrap_or(false),
    };

    let document = files::read(&app, &PathBuf::from(&path), render_options)?;

    // Recording the open is part of opening it, not a separate call the frontend
    // could forget to make. A failure to persist must not fail the open.
    if let Ok(mut config) = config::load(&app) {
        config.push_recent(&document.path);
        let _ = config::save(&app, &config);
    }

    Ok(document)
}

#[tauri::command]
pub fn scan_folder(
    path: String,
    respect_gitignore: bool,
    show_hidden: bool,
) -> LindoResult<Vec<TreeNode>> {
    files::scan(
        &PathBuf::from(path),
        ScanOptions {
            respect_gitignore,
            show_hidden,
        },
    )
}

/// Replaces the current watch set. Passing `None` for both stops watching.
#[tauri::command]
pub fn watch_paths(
    app: AppHandle,
    state: State<'_, WatchState>,
    document: Option<String>,
    folder: Option<String>,
) -> LindoResult<()> {
    files::watch(
        &app,
        &state,
        document.map(PathBuf::from),
        folder.map(PathBuf::from),
    )
}

#[tauri::command]
pub fn read_theme_file(path: String) -> LindoResult<String> {
    export::read_theme(&PathBuf::from(path))
}

#[tauri::command]
pub fn write_theme_file(path: String, contents: String) -> LindoResult<()> {
    export::write_theme(&PathBuf::from(path), &contents)
}

#[tauri::command]
pub fn write_html_file(path: String, contents: String) -> LindoResult<()> {
    export::write_html(&PathBuf::from(path), &contents)
}

/// The document this process was launched with, if the OS handed us one.
/// Returns `None` for a normal launch.
#[tauri::command]
pub fn get_initial_document() -> Option<String> {
    assoc::initial_document().map(|path| path.display().to_string())
}

/// Which application currently opens `.md`. Read fresh on every call rather than
/// cached: the user changes it in Windows Settings, outside this process, and a
/// cached "not default" would survive them fixing it.
#[tauri::command]
pub fn get_default_app_status() -> DefaultAppStatus {
    defaults::status()
}

/// Opens the OS settings page where the association can be changed. It cannot be
/// changed from here — see the module docs for why.
#[tauri::command]
pub fn request_default_app(app: AppHandle) -> LindoResult<()> {
    defaults::request_default(&app)
}
