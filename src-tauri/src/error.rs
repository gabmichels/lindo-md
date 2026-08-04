use serde::{Serialize, Serializer};

/// Every `#[tauri::command]` returns `PrettyResult<T>`. The frontend receives the
/// error as a plain readable string (see the `Serialize` impl below), so error
/// messages must be written for a user, not for a log file.
pub type PrettyResult<T> = Result<T, PrettyError>;

#[derive(Debug, thiserror::Error)]
pub enum PrettyError {
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

    #[error("{0} is not a file pretty-md can open. Supported: .md, .markdown, .mdown, .mkd")]
    UnsupportedFile(String),

    #[error("Settings file at {path} is not valid JSON: {source}. Fix or delete it — pretty-md will not overwrite it automatically.")]
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

impl PrettyError {
    pub fn msg(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }
}

/// The frontend's zod schemas expect a string, not a tagged enum: a command
/// failure surfaces in the UI as a message, and the Rust-side variant carries no
/// information the user could act on differently.
impl Serialize for PrettyError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
