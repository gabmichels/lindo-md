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

    /// Distinct from `ReadFile` because the file was read perfectly well — it is
    /// its contents that cannot be interpreted, and "Could not read" sends the
    /// reader to check permissions on a file that has none wrong with it.
    #[error(
        "{path} is not UTF-8 or UTF-16 text. lindo-md does not guess older \
         encodings, because a wrong guess renders a document that looks right \
         and is not. Re-save the file as UTF-8 and it will open."
    )]
    NotText { path: String },

    /// Names the document rather than the path, because the reader did not type
    /// this path — a file they opened did, and that is the part worth knowing.
    #[error(
        "A link in this document points at {path}, which is on another machine. \
         Opening it would connect to that host, so lindo-md did not. Open a \
         network file yourself and it will work normally."
    )]
    NetworkPath { path: String },

    /// Carries the reason as a string rather than a `rusqlite::Error` so that the
    /// error type of every command in the app does not acquire a dependency on the
    /// database. The message is the whole value here anyway — there is no variant
    /// a caller would handle differently.
    /// Deliberately does **not** tell the reader to move the file aside.
    ///
    /// It used to, for every failure alike — and most of them are transient: a
    /// second copy of the app holding the database, a full disk, a roaming
    /// profile that has not synced yet, or a file written by a newer build,
    /// which this refuses on purpose. In every one of those the right move is to
    /// wait, close the other program, or update. The advice actually given was
    /// to shift the only copy of the reader's notes out of the way, which for
    /// the newer-build case destroys exactly what the refusal exists to protect.
    #[error(
        "The annotations database at {path} could not be opened: {message} \
         Your highlights and notes are still in it, and lindo-md will not \
         replace it. If another copy of lindo-md is running, close it and try \
         again."
    )]
    AnnotationStore { path: String, message: String },

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
