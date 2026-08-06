//! User settings, persisted as pretty JSON in the platform config directory.
//!
//! Shape mirror: `src/lib/types.ts` (`AppConfig`) and the zod schema in
//! `src/lib/ipc.ts`. Keep all three in sync when adding a field.
//!
//! Themes are deliberately stored as opaque `serde_json::Value`s: the `Theme`
//! schema is large, changes often while the design is being tuned, and is fully
//! owned and validated by the frontend (`src/lib/theme/schema.ts`). Re-declaring
//! it here would be a fourth copy to keep in sync for no benefit — Rust never
//! reads inside a theme.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{LindoError, LindoResult};

const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    #[serde(default = "default_version")]
    pub version: u32,

    /// Id of the active theme — either a built-in preset or one of `custom_themes`.
    #[serde(default = "default_theme_id")]
    pub theme_id: String,

    /// "light" | "dark" | "system". Selects which half of a paired preset is used.
    #[serde(default = "default_appearance")]
    pub appearance: String,

    /// User-authored themes, validated by the frontend. Opaque here (see module doc).
    #[serde(default)]
    pub custom_themes: Vec<serde_json::Value>,

    #[serde(default = "default_rail_width")]
    pub rail_width: u32,

    #[serde(default)]
    pub rail_collapsed: bool,

    /// Most-recently-opened documents, newest first, capped at `MAX_RECENTS`.
    #[serde(default)]
    pub recent_files: Vec<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_folder: Option<String>,

    /// Privacy default: remote images are replaced by a click-to-load placeholder
    /// so opening an untrusted document cannot phone home via a tracking pixel.
    #[serde(default = "default_true")]
    pub block_remote_images: bool,

    /// Skip files ignored by `.gitignore` when scanning a folder.
    #[serde(default = "default_true")]
    pub respect_gitignore: bool,

    /// The open tab session: which files are open, in what order, how they are
    /// grouped, and which is active.
    ///
    /// Opaque for the same reasons as `custom_themes` (see module doc): the
    /// shape is nested, still settling, and fully owned and validated by the
    /// frontend — `normalize()` in `src/lib/tabs/model.ts` is the single
    /// arbiter of whether a session is well-formed, and it already runs on
    /// every load. Rust never reads inside it, so a second declaration here
    /// would only be a copy that could disagree.
    #[serde(default)]
    pub session: serde_json::Value,

    /// Show dotfiles and dot-directories in the rail.
    #[serde(default)]
    pub show_hidden_files: bool,

    /// Reopen the most recent document on launch. Ignored when the OS handed us a
    /// document to open — a double-clicked file always wins over the last one.
    #[serde(default = "default_true")]
    pub reopen_last_document: bool,

    /// Reader's zoom, multiplied into the theme's base size. Deliberately not part
    /// of the theme: nudging the text up for one document should not fork the
    /// theme, and it must not be baked into an exported file.
    #[serde(default = "default_zoom")]
    pub zoom: f64,

    /// Turn quotes, dashes and ellipses into their typographic forms.
    #[serde(default)]
    pub smart_punctuation: bool,
}

const MAX_RECENTS: usize = 20;

fn default_version() -> u32 {
    CURRENT_VERSION
}
fn default_theme_id() -> String {
    "house".to_string()
}
fn default_appearance() -> String {
    "system".to_string()
}
fn default_rail_width() -> u32 {
    264
}
fn default_true() -> bool {
    true
}
fn default_zoom() -> f64 {
    1.0
}

/// Bounds for `zoom`. Below the floor the measure collapses to a few words a
/// line; above the ceiling a heading no longer fits the canvas.
const ZOOM_RANGE: std::ops::RangeInclusive<f64> = 0.6..=2.5;

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            theme_id: default_theme_id(),
            appearance: default_appearance(),
            custom_themes: Vec::new(),
            rail_width: default_rail_width(),
            rail_collapsed: false,
            recent_files: Vec::new(),
            last_folder: None,
            block_remote_images: true,
            respect_gitignore: true,
            show_hidden_files: false,
            reopen_last_document: true,
            zoom: default_zoom(),
            smart_punctuation: false,
            session: serde_json::Value::Null,
        }
    }
}

impl AppConfig {
    /// Applied after deserializing, so a config written by an older build still
    /// loads into a sane state instead of failing validation downstream.
    fn migrate(mut self) -> Self {
        self.version = CURRENT_VERSION;
        self.rail_width = self.rail_width.clamp(200, 420);
        self.recent_files.truncate(MAX_RECENTS);
        // A NaN here would reach CSS as `NaNpx` and blank the document, and NaN
        // survives `clamp`, so it is replaced rather than bounded.
        self.zoom = if self.zoom.is_finite() {
            self.zoom.clamp(*ZOOM_RANGE.start(), *ZOOM_RANGE.end())
        } else {
            default_zoom()
        };
        self
    }

    pub fn push_recent(&mut self, path: &str) {
        self.recent_files.retain(|p| p != path);
        self.recent_files.insert(0, path.to_string());
        self.recent_files.truncate(MAX_RECENTS);
    }
}

fn config_path(app: &AppHandle) -> LindoResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| LindoError::msg(format!("No config directory available: {e}")))?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> LindoResult<AppConfig> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|source| LindoError::ReadFile {
        path: path.display().to_string(),
        source,
    })?;
    // A corrupt config is reported, never silently reset — the user's carefully
    // tuned custom themes live in this file.
    serde_json::from_str::<AppConfig>(&raw)
        .map(AppConfig::migrate)
        .map_err(|source| LindoError::ConfigParse {
            path: path.display().to_string(),
            source,
        })
}

pub fn save(app: &AppHandle, config: &AppConfig) -> LindoResult<()> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| LindoError::msg(format!("Could not serialize settings: {e}")))?;

    // Write-then-rename so an interrupted save cannot leave a half-written file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|source| LindoError::WriteFile {
        path: tmp.display().to_string(),
        source,
    })?;
    std::fs::rename(&tmp, &path).map_err(|source| LindoError::WriteFile {
        path: path.display().to_string(),
        source,
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    /// The default config, as JSON, pinned against `test/fixtures/config-default.json`.
    ///
    /// That file is the contract between this struct and the frontend. `AppConfig` here,
    /// `AppConfigSchema` in `src/lib/ipc.ts` and `FALLBACK` in `hooks/useConfig.tsx` are
    /// three hand-maintained copies of one shape — AGENTS.md says a new setting has to
    /// land in five places, and nothing checked that it had. A field added here and
    /// forgotten there was a runtime surprise for whoever opened the app next.
    ///
    /// The fixture makes the shape a thing both sides can be compared against: this test
    /// fails if Rust drifts from it, and `src/lib/ipc.test.ts` fails if either the zod
    /// schema or the fallback does.
    #[test]
    fn the_default_config_matches_the_shared_fixture() {
        let actual = serde_json::to_value(AppConfig::default()).expect("AppConfig serializes");
        let expected: serde_json::Value =
            serde_json::from_str(include_str!("../../test/fixtures/config-default.json"))
                .expect("the fixture is valid JSON");

        assert_eq!(
            actual,
            expected,
            "

AppConfig::default() no longer matches test/fixtures/config-default.json.
             If the change is intended, write this into the fixture and update the zod schema
             in src/lib/ipc.ts and FALLBACK in src/hooks/useConfig.tsx to match:

{}
",
            serde_json::to_string_pretty(&actual).unwrap_or_default()
        );
    }

    use super::*;

    #[test]
    fn defaults_round_trip_through_json() {
        let original = AppConfig::default();
        let json = serde_json::to_string(&original).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.theme_id, "house");
        assert_eq!(parsed.rail_width, 264);
        assert!(parsed.block_remote_images);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let parsed: AppConfig = serde_json::from_str(r#"{"themeId":"nord"}"#).unwrap();
        assert_eq!(parsed.theme_id, "nord");
        assert_eq!(parsed.appearance, "system");
        assert!(parsed.respect_gitignore);
    }

    #[test]
    fn migrate_clamps_rail_width_and_caps_recents() {
        let config = AppConfig {
            rail_width: 9000,
            recent_files: (0..50).map(|i| format!("f{i}.md")).collect(),
            ..Default::default()
        };
        let migrated = config.migrate();
        assert_eq!(migrated.rail_width, 420);
        assert_eq!(migrated.recent_files.len(), MAX_RECENTS);
    }

    #[test]
    fn migrate_bounds_zoom_and_rejects_non_finite_values() {
        let clamped = AppConfig {
            zoom: 40.0,
            ..Default::default()
        }
        .migrate();
        assert_eq!(clamped.zoom, *ZOOM_RANGE.end());

        // NaN passes through `clamp` unchanged, so it has to be special-cased —
        // it would otherwise reach the stylesheet as `NaNpx`.
        let repaired = AppConfig {
            zoom: f64::NAN,
            ..Default::default()
        }
        .migrate();
        assert_eq!(repaired.zoom, 1.0);
    }

    #[test]
    fn a_config_written_before_these_settings_existed_still_loads() {
        let parsed: AppConfig =
            serde_json::from_str(r#"{"themeId":"nord","railWidth":300}"#).unwrap();
        assert_eq!(parsed.zoom, 1.0);
        assert!(parsed.reopen_last_document);
        assert!(!parsed.smart_punctuation);
    }

    #[test]
    fn push_recent_moves_existing_entry_to_front_without_duplicating() {
        let mut config = AppConfig::default();
        config.push_recent("a.md");
        config.push_recent("b.md");
        config.push_recent("a.md");
        assert_eq!(config.recent_files, vec!["a.md", "b.md"]);
    }

    #[test]
    fn a_config_written_before_tabs_existed_still_loads() {
        let parsed: AppConfig = serde_json::from_str(r#"{"themeId":"nord"}"#).unwrap();
        assert!(
            parsed.session.is_null(),
            "no session means an empty session"
        );
    }

    #[test]
    fn the_session_survives_a_round_trip_untouched() {
        // Rust must not reshape it: the frontend owns the schema.
        let session = serde_json::json!({
            "tabs": [{ "id": "t1", "path": "/a.md", "groupId": "g1" }],
            "groups": [{ "id": "g1", "name": "Specs", "color": "teal" }],
            "activeTabId": "t1",
        });
        let config = AppConfig {
            session: session.clone(),
            ..Default::default()
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.session, session);
    }

    #[test]
    fn custom_themes_survive_a_round_trip_untouched() {
        let theme = serde_json::json!({ "id": "mine", "colors": { "bg": "#fff" } });
        let config = AppConfig {
            custom_themes: vec![theme.clone()],
            ..Default::default()
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.custom_themes, vec![theme]);
    }
}
