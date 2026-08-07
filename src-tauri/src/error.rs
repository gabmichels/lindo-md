use serde::{Serialize, Serializer};

/// Every `#[tauri::command]` returns `LindoResult<T>`. The frontend receives the
/// error as a plain readable string (see the `Serialize` impl below), so error
/// messages must be written for a user, not for a log file.
pub type LindoResult<T> = Result<T, LindoError>;

#[derive(Debug, thiserror::Error)]
pub enum LindoError {
    #[error("{0}")]
    Message(String),

    #[error("Could not read {path}: {source}")]
    ReadFile {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Could not write {path}: {source}")]
    WriteFile {
        path: String,
        #[source]
        source: std::io::Error,
    },

    /// The supported list is generated from the extension constants rather than
    /// written out here. Restating it is how the old four-item list came to exist in
    /// five places at once, and a user-facing message that disagrees with the code is
    /// the copy that gets believed.
    #[error(
        "{0} is not a file lindo-md can open. Supported: {supported}",
        supported = crate::files::supported_list()
    )]
    UnsupportedFile(String),

    #[error(
        "{path} changed on disk since it was opened, so saving would discard \
         those changes. Reload the document and make the edit again."
    )]
    StaleWrite { path: String },

    #[error("Settings file at {path} is not valid JSON: {source}. Fix or delete it — lindo-md will not overwrite it automatically.")]
    ConfigParse {
        path: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl LindoError {
    pub fn msg(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }
}

/// The frontend's zod schemas expect a string, not a tagged enum: a command
/// failure surfaces in the UI as a message, and the Rust-side variant carries no
/// information the user could act on differently.
impl Serialize for LindoError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
