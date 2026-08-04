//! Every command is a thin adapter: argument shaping, then a call into the module
//! that owns the logic. Business rules live in `config.rs` / `markdown.rs` /
//! `files.rs` so they stay unit-testable without a running Tauri app.

use tauri::AppHandle;

use crate::config::{self, AppConfig};
use crate::error::PrettyResult;

#[tauri::command]
pub fn get_config(app: AppHandle) -> PrettyResult<AppConfig> {
    config::load(&app)
}

#[tauri::command]
pub fn set_config(app: AppHandle, config: AppConfig) -> PrettyResult<()> {
    config::save(&app, &config)
}
