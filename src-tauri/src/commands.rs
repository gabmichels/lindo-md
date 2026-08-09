//! Every command is a thin adapter: argument shaping, then a call into the module
//! that owns the logic. Business rules live in `config.rs` / `markdown.rs` /
//! `files.rs` so they stay unit-testable without a running Tauri app.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::annotations::{self, Annotation, NewAnnotation, Reanchor};
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
pub fn open_document(
    app: AppHandle,
    path: String,
    // Whether the reader chose this path or a link in a document did. Only the
    // second is restricted, and only from reaching another machine — see
    // `files::Origin`. `#[serde(default)]` on the enum means a caller that omits
    // it gets the restricted answer rather than the permissive one.
    origin: files::Origin,
) -> LindoResult<Document> {
    // Rendering settings are read here rather than passed in: they are the same
    // for every document, and a frontend that had to remember to send them would
    // eventually render one document by different rules than the last.
    let render_options = RenderOptions {
        smart_punctuation: config::load(&app).is_ok_and(|config| config.smart_punctuation),
    };

    let document = files::read(&app, &PathBuf::from(&path), origin, render_options)?;

    // Recording the open is part of opening it, not a separate call the frontend
    // could forget to make. A failure to persist must not fail the open.
    if let Ok(mut config) = config::load(&app) {
        config.push_recent(&document.path);
        let _ = config::save(&app, &config);
    }

    Ok(document)
}

/// Writes an edited document back to disk and returns it re-rendered.
///
/// The whole source is sent rather than a range to splice: the frontend already
/// holds it, every edit is a string transform there, and one code path that
/// replaces the file is far easier to reason about than an offset protocol whose
/// two sides can disagree.
#[tauri::command]
pub fn save_document(
    app: AppHandle,
    state: State<'_, WatchState>,
    path: String,
    source: String,
    expected_hash: String,
) -> LindoResult<Document> {
    // Read the same way `open_document` does, so a document is never re-rendered
    // by different rules than it was opened under.
    let render_options = RenderOptions {
        smart_punctuation: config::load(&app).is_ok_and(|config| config.smart_punctuation),
    };

    files::save(
        &app,
        &state,
        &PathBuf::from(&path),
        &source,
        &expected_hash,
        render_options,
    )
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

/// Replaces the current watch set. An empty list and no folder stops watching.
#[tauri::command]
pub fn watch_paths(
    app: AppHandle,
    state: State<'_, WatchState>,
    documents: Vec<String>,
    folder: Option<String>,
) -> LindoResult<()> {
    files::watch(
        &app,
        &state,
        documents.into_iter().map(PathBuf::from).collect(),
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

/// The documents the OS has handed us and the window has not collected yet — the
/// launch argument, a double-clicked file, an "Open with". Empty for a normal
/// launch. Collecting drains the queue; see `assoc::OpenQueue` for why there is
/// a queue rather than an event alone.
#[tauri::command]
pub fn get_pending_documents(app: AppHandle) -> Vec<String> {
    assoc::take_pending(&app)
        .iter()
        .map(|path| path.display().to_string())
        .collect()
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

// --- annotations -------------------------------------------------------------
// Storage only. Whether an annotation's offsets still describe the file, and
// where it moved to if they do not, is decided in `src/lib/annotate/anchor.ts` —
// see the module docs in `annotations.rs` for why that side owns it.

#[tauri::command]
pub fn list_annotations(
    app: AppHandle,
    store: State<'_, annotations::Store>,
    path: String,
) -> LindoResult<Vec<Annotation>> {
    store.with(&app, |connection| annotations::list(connection, &path))
}

/// Every annotation in the database, across every folder. The "everything I
/// marked about X" view; filtering is the frontend's.
#[tauri::command]
pub fn all_annotations(
    app: AppHandle,
    store: State<'_, annotations::Store>,
) -> LindoResult<Vec<Annotation>> {
    store.with(&app, |connection| annotations::all(connection))
}

#[tauri::command]
pub fn create_annotation(
    app: AppHandle,
    store: State<'_, annotations::Store>,
    annotation: NewAnnotation,
) -> LindoResult<Annotation> {
    store.with(&app, |connection| {
        annotations::create(connection, &annotation)
    })
}

#[tauri::command]
pub fn update_annotation(
    app: AppHandle,
    store: State<'_, annotations::Store>,
    id: i64,
    color: String,
    body: String,
) -> LindoResult<Annotation> {
    store.with(&app, |connection| {
        annotations::update(connection, id, &color, &body)
    })
}

/// Writes back offsets the frontend re-found after the document changed. Batched
/// and transactional: a document reloads with all of its annotations resolved at
/// once, and half of them agreeing with the new file is worse than none.
#[tauri::command]
pub fn reanchor_annotations(
    app: AppHandle,
    store: State<'_, annotations::Store>,
    updates: Vec<Reanchor>,
) -> LindoResult<()> {
    store.with(&app, |connection| {
        annotations::reanchor(connection, &updates)
    })
}

#[tauri::command]
pub fn delete_annotation(
    app: AppHandle,
    store: State<'_, annotations::Store>,
    id: i64,
) -> LindoResult<()> {
    store.with(&app, |connection| annotations::delete(connection, id))
}
