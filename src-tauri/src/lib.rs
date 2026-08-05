// `panic = "abort"` is set in the release profile, so a panic reachable from a document
// is not an error message: it takes the window down with every open tab, and the input is
// arbitrary Markdown from an arbitrary file.
//
// Denied here rather than in Cargo.toml's `[lints]` because that table applies to every
// target in the package, including the integration tests under `tests/` — separate crates
// that cannot see the `cfg_attr` below and are entitled to assert by panicking.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
// A panicking test is a failing test — that is the mechanism working, not a violation.
#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing,
        // Fixture values compared exactly, helper `fn`s declared beside the assertions
        // that use them, and `Default::default()` spelled out in struct literals.
        clippy::float_cmp,
        clippy::items_after_statements,
        clippy::default_trait_access
    )
)]

mod assoc;
mod commands;
mod config;
mod defaults;
mod error;
mod export;
mod files;
mod markdown;
mod srcmap;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

use files::WatchState;

/// Builds the Tauri application and runs it to completion.
///
/// # Panics
///
/// If the webview cannot be created. There is no window to report that in, and no
/// meaningful way to continue without one.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(
    clippy::expect_used,
    reason = "startup failure has nowhere to be reported"
)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        // Must be registered first, per the plugin's contract: a second launch
        // (a double-clicked .md while the app is open) is routed into the
        // running window rather than starting another copy. This never fires on
        // macOS, which reactivates the running bundle itself and sends an Apple
        // Event instead — handled in the run loop below.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            assoc::deliver(app, assoc::document_from_args(argv));
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
        .manage(WatchState::default())
        // Reads argv now, so the launch argument is already queued before the
        // webview that collects it exists — see `OpenQueue::from_launch`.
        .manage(assoc::OpenQueue::from_launch());

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
            commands::get_pending_documents,
            commands::get_default_app_status,
            commands::request_default_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building lindo-md")
        // `build` + `run` rather than `run` alone, purely to get at the run loop:
        // `RunEvent::Opened` is the *only* way a double-clicked document reaches
        // the app on macOS, and it has nowhere else to be observed.
        .run(|_app, _event| {
            // Underscored so the non-macOS builds, where the block below is
            // compiled out, do not warn on unused parameters — CI treats clippy
            // warnings as errors.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                assoc::deliver(_app, assoc::documents_from_urls(urls.iter()));
            }
        });
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
