//! Keeps `tauri.conf.json` and `tauri.macos.conf.json` from drifting apart.
//!
//! macOS needs a different window than Windows and Linux do: the traffic lights
//! only exist on a window with `decorations: true`, because `tao` builds the
//! style mask without `NSWindowStyleMask::Titled` when decorations are off, and
//! the buttons are subviews of the titlebar that mask creates. Windows and Linux
//! draw their own controls (see `TitleBar.tsx`) and so stay undecorated.
//!
//! Tauri merges a platform config over the base one with JSON Merge Patch
//! (RFC 7396), which treats arrays as atomic values. `app.windows` is an array,
//! so the macOS file does not deep-merge into the first window — it *replaces*
//! the whole array. Any property it fails to restate silently reverts to a serde
//! default, which is how you end up shipping an 800x600 window titled
//! "Tauri App" and only hearing about it from a user.
//!
//! That makes the duplication load-bearing rather than sloppy, so this test
//! guards it: the two window objects must agree on every shared key, and the
//! only keys allowed to appear on one side are the ones listed below.
//!
//! It lives in `tests/` rather than beside a module because it tests the build's
//! inputs, not any code — there is no module for it to sit next to.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

/// Keys the two files are *expected* to disagree on. Anything else that differs
/// is drift.
const DIVERGENT: &[&str] = &["decorations"];

/// Keys macOS alone carries. `tao` ignores all three off macOS, so restating
/// them in the base config would only suggest they did something there.
const MACOS_ONLY: &[&str] = &["titleBarStyle", "hiddenTitle", "trafficLightPosition"];

fn window(config: &str) -> Map<String, Value> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/").to_string() + config;
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let json: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));

    json["app"]["windows"]
        .as_array()
        .and_then(|windows| windows.first())
        .and_then(Value::as_object)
        .unwrap_or_else(|| panic!("{path}: no app.windows[0]"))
        .clone()
}

fn base() -> Map<String, Value> {
    window("tauri.conf.json")
}

fn macos() -> Map<String, Value> {
    window("tauri.macos.conf.json")
}

#[test]
fn macos_restates_every_shared_window_property() {
    let (base, macos) = (base(), macos());

    for (key, value) in &base {
        if DIVERGENT.contains(&key.as_str()) {
            continue;
        }
        let Some(theirs) = macos.get(key) else {
            panic!(
                "tauri.macos.conf.json is missing `{key}`. RFC 7396 replaces the \
                 whole `app.windows` array, so on macOS it would fall back to \
                 Tauri's default instead of `{value}`."
            );
        };
        assert_eq!(
            value, theirs,
            "`{key}` has drifted: tauri.conf.json says {value}, \
             tauri.macos.conf.json says {theirs}"
        );
    }
}

#[test]
fn neither_file_carries_a_property_the_other_should_have() {
    let (base, macos) = (base(), macos());
    let allowed: BTreeSet<&str> = MACOS_ONLY.iter().copied().collect();

    let extra: Vec<&String> = macos
        .keys()
        .filter(|key| !base.contains_key(*key) && !allowed.contains(key.as_str()))
        .collect();

    assert!(
        extra.is_empty(),
        "tauri.macos.conf.json sets {extra:?}, which tauri.conf.json does not. \
         Either add them to the base config or list them in MACOS_ONLY."
    );
}

/// Not a style question: `tao` calls `.unwrap()` on `standardWindowButton(_:)`
/// for all three buttons when positioning them, and a borderless window returns
/// `None` for every one. Pairing `trafficLightPosition` with `decorations: false`
/// therefore panics on launch rather than looking wrong.
#[test]
fn traffic_lights_are_only_positioned_on_a_decorated_window() {
    let macos = macos();

    if macos.contains_key("trafficLightPosition") {
        assert_eq!(
            macos.get("decorations"),
            Some(&Value::Bool(true)),
            "trafficLightPosition requires decorations: true — tao unwraps \
             standardWindowButton(), which is None on a borderless window, so \
             this combination panics at launch."
        );
        assert_eq!(
            macos.get("titleBarStyle").and_then(Value::as_str),
            Some("Overlay"),
            "trafficLightPosition only makes sense with titleBarStyle: Overlay, \
             which is what extends the content under the titlebar."
        );
    }
}

/// The whole point of the split: macOS keeps the system's window controls, the
/// other platforms draw their own.
#[test]
fn macos_is_decorated_and_the_base_config_is_not() {
    assert_eq!(base().get("decorations"), Some(&Value::Bool(false)));
    assert_eq!(macos().get("decorations"), Some(&Value::Bool(true)));
}
