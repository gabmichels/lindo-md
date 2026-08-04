mod commands;
mod config;
mod error;
mod export;
mod files;
mod markdown;

use files::WatchState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running pretty-md");
}
