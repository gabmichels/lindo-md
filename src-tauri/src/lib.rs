mod assoc;
mod commands;
mod config;
mod defaults;
mod error;
mod export;
mod files;
mod markdown;
mod srcmap;

use tauri::{Emitter, Manager};
use tauri_plugin_window_state::StateFlags;

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
        // Size, position and maximized state survive a restart. The remaining
        // default flags are deliberately left out: they restore properties this
        // app never varies — the window is frameless and always visible by
        // config, and there is no fullscreen affordance anywhere in the UI — so
        // saving them only risks a restored value contradicting `tauri.conf.json`.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
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
            commands::save_document,
            commands::scan_folder,
            commands::watch_paths,
            commands::read_theme_file,
            commands::write_theme_file,
            commands::write_html_file,
            commands::get_initial_document,
            commands::get_default_app_status,
            commands::request_default_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running lindo-md");
}

#[cfg(test)]
mod tests {
    /// The opener plugin splits the command grant from the URL scope: `allow-open-url`
    /// enables `open_url` *with no scope at all*, and the `http`/`https`/`mailto`/`tel`
    /// globs live only in `allow-default-urls`. Granting the first without the second
    /// compiles, passes every other test, and makes `open_url` reject every URL — which
    /// is how v1.0.0 shipped with every external link in every document silently dead.
    ///
    /// This is a config invariant with no runtime representation, so it is asserted
    /// against the manifest text rather than through the app.
    #[test]
    fn opener_command_grant_comes_with_a_url_scope() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("capabilities/default.json is valid JSON");

        let permissions: Vec<&str> = capability["permissions"]
            .as_array()
            .expect("the capability has a permissions array")
            .iter()
            .filter_map(|p| p.as_str())
            .collect();

        if permissions.contains(&"opener:allow-open-url") {
            assert!(
                permissions.contains(&"opener:allow-default-urls")
                    || capability.get("scope").is_some(),
                "opener:allow-open-url is granted without a URL scope, so every open_url \
                 call will be rejected. Add opener:allow-default-urls (or an explicit scope)."
            );
        }
    }
}
