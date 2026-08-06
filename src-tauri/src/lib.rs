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
        // The only two plugins in this list that can reach the network or replace
        // the binary on disk, and they are a pair: `updater` fetches and installs,
        // `process` performs the relaunch afterwards. Neither does anything on its
        // own initiative — the frontend decides when to check (see `update.ts`),
        // and an installer the release key did not sign is rejected here, in Rust,
        // before it is run. The public key that decides that lives in
        // `tauri.conf.json`; the private half never leaves the release workflow.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                assoc::deliver(app, assoc::documents_from_urls(urls.iter()));
            }
            // Everywhere else the block above is compiled out and both parameters go
            // unread. They used to be underscore-prefixed for that, but then the macOS
            // build — the one place they *are* read — trips `used_underscore_binding`.
            // Consuming them explicitly satisfies both sides without a lint exception.
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    /// The updater has the same shape of trap the opener test below describes, with a worse
    /// failure mode: `updater:default` enables `check()` from the webview, but what makes an
    /// update *installable* is the minisign public key in `tauri.conf.json`, and what makes
    /// one *exist* is `bundle.createUpdaterArtifacts`. The three are independent switches
    /// that only work together.
    ///
    /// Each way of getting it wrong is silent in a different direction. No `pubkey` and every
    /// check fails at runtime with a message no reader will see, because the settings panel
    /// reports a failed check as "could not reach GitHub". No `createUpdaterArtifacts` and the
    /// release builds cleanly, publishes installers with no signatures beside them, and the
    /// manifest job is the first thing to notice — one release too late.
    ///
    /// Config invariants with no runtime representation, so they are asserted against the
    /// manifest text, exactly as the opener one is.
    #[test]
    fn the_updater_grant_comes_with_a_key_and_artifacts_to_verify() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("capabilities/default.json is valid JSON");
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json is valid JSON");

        let permissions: Vec<&str> = capability["permissions"]
            .as_array()
            .expect("the capability has a permissions array")
            .iter()
            .filter_map(|p| p.as_str())
            .collect();

        if !permissions.contains(&"updater:default") {
            return;
        }

        let updater = &config["plugins"]["updater"];

        assert!(
            updater["pubkey"].as_str().is_some_and(|k| !k.is_empty()),
            "updater:default is granted with no plugins.updater.pubkey, so every update \
             check fails at runtime and the app reports it as being unable to reach GitHub."
        );

        assert_eq!(
            config["bundle"]["createUpdaterArtifacts"],
            serde_json::Value::Bool(true),
            "the app can check for updates but the bundler produces none to find. Set \
             bundle.createUpdaterArtifacts."
        );

        let endpoints = updater["endpoints"]
            .as_array()
            .expect("plugins.updater.endpoints is a list");
        assert!(
            !endpoints.is_empty(),
            "updater:default is granted with no endpoint to ask."
        );
        // `dangerousInsecureTransportProtocol` is what it takes to use a plain-HTTP
        // endpoint, and the signature check is not a reason to accept one: it stops a
        // forged *update*, not someone watching which version every reader is running.
        for endpoint in endpoints {
            let url = endpoint.as_str().unwrap_or_default();
            assert!(
                url.starts_with("https://"),
                "updater endpoint {url} is not https"
            );
        }
    }

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
