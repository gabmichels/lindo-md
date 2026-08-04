mod assoc;
mod commands;
mod config;
mod error;
mod export;
mod files;
mod markdown;

use tauri::{Emitter, Manager};

use files::WatchState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        // Must be registered first, per the plugin's contract: a second launch
        // (a double-clicked .md while the app is open) is routed into the
        // running window rather than starting another copy.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = assoc::document_from_args(argv) {
                let _ = app.emit("open-document", path.display().to_string());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(WatchState::default());

    // Logging is a development aid; a release build stays silent.
    if cfg!(debug_assertions) {
        builder = builder.plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        );
    }

    builder
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::open_document,
            commands::scan_folder,
            commands::watch_paths,
            commands::read_theme_file,
            commands::write_theme_file,
            commands::write_html_file,
            commands::get_initial_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running lindo-md");
}
