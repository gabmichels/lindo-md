//! Where a reader's highlights and margin notes are kept.
//!
//! **This module stores anchors; it does not resolve them.** An annotation points
//! at a range of a document two different ways at once — a pair of offsets, and
//! the quoted text with a little context either side — and deciding which of the
//! two still describes the file is arithmetic over a JavaScript string, done in
//! `src/lib/annotate/anchor.ts`. Rust holds the rows and answers questions about
//! them. That split is the same one `config.rs` already makes for themes and the
//! tab session: the side that validates a shape is the side that owns it.
//!
//! Two things about the numbers in here are load-bearing, and both are invisible
//! at the point where they would be got wrong:
//!
//! - **`start_offset` and `end_offset` are UTF-16 code units**, because that is
//!   what `srcmap::TextRun` hands the webview and what a JavaScript string is
//!   indexed by. They are not bytes. A document containing an em-dash, an accent
//!   or an emoji makes the two disagree, which is to say most documents.
//! - **They index the LF-normalized source**, the string `text::decode` produced
//!   and `data-sourcepos` describes — never the bytes on disk. In a CRLF file the
//!   two drift by one character per preceding line, so a mark near the bottom of
//!   a long document would land a paragraph away.
//!
//! There is deliberately no `kind` column. A note is an annotation with a body
//! and a highlight is one without, which cannot contradict itself the way a
//! `kind` that disagrees with the other columns can.
//!
//! `color` is a **slot name**, not a colour. Themes rewrite every `--doc-*` token,
//! so storing `#ffee00` would freeze a mark to a colour that clashes with the next
//! theme the reader picks. What is stored is which of the theme's highlight slots
//! this mark uses; the theme decides what that looks like.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{LindoError, LindoResult};

/// Bumped when the schema changes, and compared against SQLite's own
/// `user_version` pragma. A database from a newer build than this one is refused
/// rather than migrated backwards — see `migrate`.
const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: i64,
    pub path: String,
    /// Which of the theme's highlight slots paints this mark. Not a colour value.
    pub color: String,
    /// The margin note. Empty for a bare highlight; there is no separate `kind`.
    pub body: String,
    /// Exactly the text that was selected, and roughly 32 characters either side
    /// of it. Together these re-find the mark in a document that has been edited
    /// since — see `anchor.ts`.
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    /// UTF-16 code units into the LF-normalized source. See the module docs.
    pub start_offset: i64,
    pub end_offset: i64,
    /// The `contentHash` the offsets above were computed against. When it still
    /// matches the document's, they are correct and no search is needed.
    pub anchored_hash: String,
    /// Milliseconds since the epoch. An integer rather than a formatted string so
    /// that sorting is sorting and no date library has to enter the tree.
    pub created_at: i64,
    pub updated_at: i64,
}

/// A new annotation, before the store has given it an id or timestamps.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAnnotation {
    pub path: String,
    pub color: String,
    #[serde(default)]
    pub body: String,
    pub quote: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub anchored_hash: String,
}

/// One annotation's offsets rewritten after the document changed under it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reanchor {
    pub id: i64,
    pub start_offset: i64,
    pub end_offset: i64,
    pub anchored_hash: String,
}

/// The open database, or nothing yet.
///
/// Opened on first use rather than at startup: a reader who never annotates
/// anything should not pay for a file being created, and `setup` has no good way
/// to report a failure to anyone.
#[derive(Default)]
pub struct Store(Mutex<Option<Connection>>);

impl Store {
    /// Runs `work` against the open database, opening it first if needed.
    ///
    /// A closure rather than a returned guard because the connection lives inside
    /// an `Option` inside a lock, and handing that back out means either a
    /// self-referential guard type or a second `Option` for every caller to
    /// unwrap. It is handed over mutably because a transaction needs it that way,
    /// and one accessor is easier to keep honest than two.
    pub fn with<T>(
        &self,
        app: &AppHandle,
        work: impl FnOnce(&mut Connection) -> LindoResult<T>,
    ) -> LindoResult<T> {
        // A poisoned lock means some earlier call panicked while holding it. The
        // database is not damaged by that — SQLite has its own transactions — and
        // refusing every later call would turn one fault into a dead feature.
        let mut guard = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.is_none() {
            *guard = Some(open(app)?);
        }
        let Some(connection) = guard.as_mut() else {
            return Err(LindoError::msg("The annotations database is not open."));
        };
        work(connection)
    }
}

fn database_path(app: &AppHandle) -> LindoResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| LindoError::msg(format!("No config directory available: {e}")))?;
    Ok(dir.join("annotations.db"))
}

fn open(app: &AppHandle) -> LindoResult<Connection> {
    let path = database_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(&path).map_err(|e| store_error(&path, &e.to_string()))?;
    migrate(&connection).map_err(|e| store_error(&path, &e))?;
    Ok(connection)
}

fn store_error(path: &Path, message: &str) -> LindoError {
    LindoError::AnnotationStore {
        path: path.display().to_string(),
        message: message.to_owned(),
    }
}

/// Brings an empty or older database up to `SCHEMA_VERSION`.
///
/// A database from a *newer* build is refused rather than used. Opening it would
/// work — SQLite does not mind columns this build has never heard of — right up
/// until a write silently dropped whatever the newer version was keeping in them,
/// which is the reader's own notes.
fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;

    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if version > SCHEMA_VERSION {
        return Err(format!(
            "it was written by a newer version of lindo-md (format {version}, this build reads {SCHEMA_VERSION})"
        ));
    }
    if version == SCHEMA_VERSION {
        return Ok(());
    }

    connection
        .execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS annotation (
               id            INTEGER PRIMARY KEY,
               path          TEXT    NOT NULL,
               color         TEXT    NOT NULL,
               body          TEXT    NOT NULL DEFAULT '',
               quote         TEXT    NOT NULL,
               prefix        TEXT    NOT NULL DEFAULT '',
               suffix        TEXT    NOT NULL DEFAULT '',
               start_offset  INTEGER NOT NULL,
               end_offset    INTEGER NOT NULL,
               anchored_hash TEXT    NOT NULL,
               created_at    INTEGER NOT NULL,
               updated_at    INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS annotation_path ON annotation(path);
             PRAGMA user_version = 1;
             COMMIT;",
        )
        .map_err(|e| e.to_string())
}

/// The key a document's annotations are filed under.
///
/// Canonicalized where possible, so that `C:\notes\a.md` and `C:\notes\..\notes\a.md`
/// are one document rather than two — a reader who opens the same file from the
/// tree and from a link should not find half their marks missing. A path that
/// cannot be canonicalized (the file is gone) is used as given: there is nothing
/// better to key by, and a document that cannot be read cannot be annotated.
///
/// Note what this does *not* survive: renaming or moving a file loses the link to
/// its annotations. They are still in the database, and `anchored_hash` is enough
/// to offer to re-link them later, but nothing does that yet.
fn key_for(path: &str) -> String {
    std::fs::canonicalize(path).map_or_else(|_| path.to_owned(), |p| p.display().to_string())
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

const COLUMNS: &str = "id, path, color, body, quote, prefix, suffix, \
                       start_offset, end_offset, anchored_hash, created_at, updated_at";

fn row_to_annotation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Annotation> {
    Ok(Annotation {
        id: row.get(0)?,
        path: row.get(1)?,
        color: row.get(2)?,
        body: row.get(3)?,
        quote: row.get(4)?,
        prefix: row.get(5)?,
        suffix: row.get(6)?,
        start_offset: row.get(7)?,
        end_offset: row.get(8)?,
        anchored_hash: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn query(
    connection: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> LindoResult<Vec<Annotation>> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|e| LindoError::msg(format!("Could not read annotations: {e}")))?;
    let rows = statement
        .query_map(params, row_to_annotation)
        .map_err(|e| LindoError::msg(format!("Could not read annotations: {e}")))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| LindoError::msg(format!("Could not read annotations: {e}")))
}

/// Every annotation on one document, oldest first.
pub fn list(connection: &Connection, path: &str) -> LindoResult<Vec<Annotation>> {
    query(
        connection,
        &format!("SELECT {COLUMNS} FROM annotation WHERE path = ?1 ORDER BY start_offset, id"),
        &[&key_for(path)],
    )
}

/// Every annotation in the database, newest first — the cross-folder view.
pub fn all(connection: &Connection) -> LindoResult<Vec<Annotation>> {
    query(
        connection,
        &format!("SELECT {COLUMNS} FROM annotation ORDER BY updated_at DESC, id DESC"),
        &[],
    )
}

/// Moves a document's marks to the path it now lives at, if they can be found.
///
/// Annotations are filed under a path, so renaming or moving a file cuts them
/// loose: the rows are all still there, and nothing was looking for them. This
/// is what looks.
///
/// **The evidence that two paths are the same document is the content hash**,
/// which every annotation already carries as `anchored_hash` — the fingerprint of
/// the source its offsets were computed against, kept current by `reanchor`. A
/// renamed file is almost always byte-identical to the one that was renamed, so
/// its marks are exactly the rows whose anchor hash equals this document's.
///
/// Three conditions, and each one is refusing a way this could take marks that
/// belong to something else:
///
/// - **This path has no marks of its own.** Otherwise a document with one
///   highlight would adopt another document's twenty.
/// - **Exactly one other path matches.** Two candidates means two files with
///   identical content, and nothing here can tell which was renamed into this
///   one. Doing nothing loses no data — the marks stay where they are — while
///   guessing puts a reader's notes on a file they never opened.
/// - **The old path is gone from disk.** This is what separates a *rename* from
///   a *copy*. If the original is still there its marks are still reachable by
///   opening it, and moving them would take them away from a document that still
///   exists.
///
/// Returns how many marks were moved, so the caller knows whether to load again.
pub fn relink(connection: &Connection, path: &str, content_hash: &str) -> LindoResult<usize> {
    let key = key_for(path);

    let mine: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM annotation WHERE path = ?1",
            [&key],
            |row| row.get(0),
        )
        .map_err(|e| LindoError::msg(format!("Could not look for moved annotations: {e}")))?;
    if mine > 0 {
        return Ok(0);
    }

    let mut statement = connection
        .prepare("SELECT DISTINCT path FROM annotation WHERE anchored_hash = ?1 AND path <> ?2")
        .map_err(|e| LindoError::msg(format!("Could not look for moved annotations: {e}")))?;
    let candidates = statement
        .query_map(rusqlite::params![content_hash, key], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| LindoError::msg(format!("Could not look for moved annotations: {e}")))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| LindoError::msg(format!("Could not look for moved annotations: {e}")))?;

    // Only paths that have actually gone. A candidate still on disk is a copy,
    // or the same file open under a second name, and its marks are not ours.
    let mut gone = candidates
        .into_iter()
        .filter(|candidate| !Path::new(candidate).exists());
    let (Some(from), None) = (gone.next(), gone.next()) else {
        return Ok(0);
    };

    connection
        .execute(
            "UPDATE annotation SET path = ?1 WHERE path = ?2",
            rusqlite::params![key, from],
        )
        .map_err(|e| LindoError::msg(format!("Could not move the annotations: {e}")))
}

pub fn create(connection: &Connection, new: &NewAnnotation) -> LindoResult<Annotation> {
    if new.quote.is_empty() {
        return Err(LindoError::msg(
            "An annotation needs some selected text to attach to.",
        ));
    }
    let now = now_millis();
    let path = key_for(&new.path);
    connection
        .execute(
            "INSERT INTO annotation
               (path, color, body, quote, prefix, suffix,
                start_offset, end_offset, anchored_hash, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            rusqlite::params![
                path,
                new.color,
                new.body,
                new.quote,
                new.prefix,
                new.suffix,
                new.start_offset,
                new.end_offset,
                new.anchored_hash,
                now,
            ],
        )
        .map_err(|e| LindoError::msg(format!("Could not save the annotation: {e}")))?;

    fetch(connection, connection.last_insert_rowid())
}

/// Changes the colour slot, the note, or both. Anything else about an annotation
/// — where it points — changes only through `reanchor`.
pub fn update(
    connection: &Connection,
    id: i64,
    color: &str,
    body: &str,
) -> LindoResult<Annotation> {
    let changed = connection
        .execute(
            "UPDATE annotation SET color = ?2, body = ?3, updated_at = ?4 WHERE id = ?1",
            rusqlite::params![id, color, body, now_millis()],
        )
        .map_err(|e| LindoError::msg(format!("Could not update the annotation: {e}")))?;
    if changed == 0 {
        return Err(LindoError::msg("That annotation no longer exists."));
    }
    fetch(connection, id)
}

/// Writes back offsets that were re-found after the document changed.
///
/// A transaction because a half-applied re-anchor is worse than none: the
/// annotations that were rewritten would agree with the new file and the rest
/// would still claim the old hash, so the next resolve would search for marks it
/// had already placed.
///
/// Deliberately does **not** touch `updated_at`. Re-anchoring is bookkeeping the
/// app did, not something the reader changed, and letting it reorder the
/// cross-document list would put whichever file was opened last at the top.
pub fn reanchor(connection: &mut Connection, updates: &[Reanchor]) -> LindoResult<()> {
    let transaction = connection
        .transaction()
        .map_err(|e| LindoError::msg(format!("Could not update annotations: {e}")))?;
    for update in updates {
        transaction
            .execute(
                "UPDATE annotation SET start_offset = ?2, end_offset = ?3, anchored_hash = ?4
                 WHERE id = ?1",
                rusqlite::params![
                    update.id,
                    update.start_offset,
                    update.end_offset,
                    update.anchored_hash
                ],
            )
            .map_err(|e| LindoError::msg(format!("Could not update annotations: {e}")))?;
    }
    transaction
        .commit()
        .map_err(|e| LindoError::msg(format!("Could not update annotations: {e}")))
}

pub fn delete(connection: &Connection, id: i64) -> LindoResult<()> {
    connection
        .execute("DELETE FROM annotation WHERE id = ?1", [id])
        .map_err(|e| LindoError::msg(format!("Could not delete the annotation: {e}")))?;
    Ok(())
}

fn fetch(connection: &Connection, id: i64) -> LindoResult<Annotation> {
    query(
        connection,
        &format!("SELECT {COLUMNS} FROM annotation WHERE id = ?1"),
        &[&id],
    )?
    .into_iter()
    .next()
    .ok_or_else(|| LindoError::msg("That annotation no longer exists."))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        connection
    }

    fn sample(path: &str) -> NewAnnotation {
        NewAnnotation {
            path: path.to_owned(),
            color: "yellow".to_owned(),
            body: String::new(),
            quote: "the quoted words".to_owned(),
            prefix: "before ".to_owned(),
            suffix: " after".to_owned(),
            start_offset: 10,
            end_offset: 26,
            anchored_hash: "hash-one".to_owned(),
        }
    }

    #[test]
    fn a_created_annotation_comes_back_intact() {
        let connection = store();
        let made = create(&connection, &sample("notes.md")).unwrap();

        assert_eq!(made.quote, "the quoted words");
        assert_eq!(made.start_offset, 10);
        assert_eq!(made.end_offset, 26);
        assert_eq!(made.anchored_hash, "hash-one");
        // A bare highlight is a body-less annotation rather than a `kind` column
        // that could disagree with the body beside it.
        assert!(made.body.is_empty());
        assert_eq!(made.created_at, made.updated_at);
    }

    #[test]
    fn migrating_twice_changes_nothing() {
        let connection = store();
        create(&connection, &sample("notes.md")).unwrap();
        migrate(&connection).unwrap();
        assert_eq!(list(&connection, "notes.md").unwrap().len(), 1);
    }

    #[test]
    fn a_database_from_a_newer_build_is_refused_rather_than_written_to() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();

        let refused = migrate(&connection);

        assert!(refused.is_err(), "a newer schema must not be opened");
        // The reader's notes are still there. Nothing was dropped or recreated.
        assert!(refused.unwrap_err().contains("newer version"));
    }

    #[test]
    fn annotations_are_listed_per_document_in_reading_order() {
        let connection = store();
        let mut second = sample("notes.md");
        second.start_offset = 4;
        second.end_offset = 8;
        create(&connection, &sample("notes.md")).unwrap();
        create(&connection, &second).unwrap();
        create(&connection, &sample("other.md")).unwrap();

        let listed = list(&connection, "notes.md").unwrap();

        assert_eq!(listed.len(), 2);
        assert_eq!(listed.first().map(|a| a.start_offset), Some(4));
        assert_eq!(listed.get(1).map(|a| a.start_offset), Some(10));
    }

    #[test]
    fn an_annotation_with_no_quote_is_refused() {
        let connection = store();
        let mut empty = sample("notes.md");
        empty.quote = String::new();

        // Without a quote there is nothing to search for when the offsets go
        // stale, so the mark could never be recovered — it would simply be wrong
        // after the first edit, silently.
        assert!(create(&connection, &empty).is_err());
    }

    #[test]
    fn updating_sets_the_body_and_leaves_the_anchor_alone() {
        let connection = store();
        let made = create(&connection, &sample("notes.md")).unwrap();

        let noted = update(&connection, made.id, "green", "worth checking").unwrap();

        assert_eq!(noted.body, "worth checking");
        assert_eq!(noted.color, "green");
        assert_eq!(noted.start_offset, made.start_offset);
        assert_eq!(noted.anchored_hash, made.anchored_hash);
    }

    #[test]
    fn updating_something_that_is_gone_says_so() {
        let connection = store();
        assert!(update(&connection, 404, "yellow", "").is_err());
    }

    #[test]
    fn reanchoring_moves_the_offsets_and_records_the_hash_they_now_describe() {
        let mut connection = store();
        let made = create(&connection, &sample("notes.md")).unwrap();

        reanchor(
            &mut connection,
            &[Reanchor {
                id: made.id,
                start_offset: 40,
                end_offset: 56,
                anchored_hash: "hash-two".to_owned(),
            }],
        )
        .unwrap();

        let moved = fetch(&connection, made.id).unwrap();
        assert_eq!(moved.start_offset, 40);
        assert_eq!(moved.end_offset, 56);
        assert_eq!(moved.anchored_hash, "hash-two");
        // Bookkeeping, not an edit by the reader — see `reanchor`.
        assert_eq!(moved.updated_at, made.updated_at);
    }

    #[test]
    fn a_renamed_document_gets_its_marks_back() {
        let connection = store();
        // A path that no longer exists, which is what a rename leaves behind.
        let mut old = sample("C:/notes/old-name.md");
        old.anchored_hash = "same-content".to_owned();
        create(&connection, &old).unwrap();

        let moved = relink(&connection, "C:/notes/new-name.md", "same-content").unwrap();

        assert_eq!(moved, 1);
        assert_eq!(list(&connection, "C:/notes/new-name.md").unwrap().len(), 1);
        assert!(list(&connection, "C:/notes/old-name.md")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_document_that_already_has_marks_does_not_adopt_more() {
        let connection = store();
        let mut theirs = sample("C:/notes/old-name.md");
        theirs.anchored_hash = "same-content".to_owned();
        create(&connection, &theirs).unwrap();
        let mut mine = sample("C:/notes/new-name.md");
        mine.anchored_hash = "same-content".to_owned();
        create(&connection, &mine).unwrap();

        assert_eq!(
            relink(&connection, "C:/notes/new-name.md", "same-content").unwrap(),
            0
        );
        assert_eq!(list(&connection, "C:/notes/new-name.md").unwrap().len(), 1);
    }

    #[test]
    fn two_identical_documents_are_left_alone_rather_than_guessed_between() {
        let connection = store();
        for path in ["C:/notes/a.md", "C:/notes/b.md"] {
            let mut one = sample(path);
            one.anchored_hash = "same-content".to_owned();
            create(&connection, &one).unwrap();
        }

        // Nothing here can tell which was renamed into `c.md`. Doing nothing
        // loses no marks; guessing puts them on a file nobody marked.
        assert_eq!(
            relink(&connection, "C:/notes/c.md", "same-content").unwrap(),
            0
        );
    }

    #[test]
    fn a_copy_does_not_steal_the_original_s_marks() {
        let connection = store();
        // The source path is this test file's own crate manifest: something that
        // certainly exists, standing in for an original that was copied rather
        // than renamed.
        let existing = env!("CARGO_MANIFEST_DIR").to_owned() + "/Cargo.toml";
        let mut one = sample(&existing);
        one.anchored_hash = "same-content".to_owned();
        create(&connection, &one).unwrap();

        assert_eq!(
            relink(&connection, "C:/notes/copy.md", "same-content").unwrap(),
            0
        );
        assert_eq!(list(&connection, &existing).unwrap().len(), 1);
    }

    #[test]
    fn a_renamed_document_that_was_also_edited_is_not_claimed() {
        let connection = store();
        let mut old = sample("C:/notes/old-name.md");
        old.anchored_hash = "content-before".to_owned();
        create(&connection, &old).unwrap();

        // The hash is the only evidence there is. Changed content means no
        // evidence, and inventing some would be worse than the marks staying put.
        assert_eq!(
            relink(&connection, "C:/notes/new-name.md", "content-after").unwrap(),
            0
        );
    }

    #[test]
    fn deleting_removes_only_that_one() {
        let connection = store();
        let first = create(&connection, &sample("notes.md")).unwrap();
        create(&connection, &sample("notes.md")).unwrap();

        delete(&connection, first.id).unwrap();

        assert_eq!(list(&connection, "notes.md").unwrap().len(), 1);
    }

    #[test]
    fn the_cross_document_view_spans_folders() {
        let connection = store();
        create(&connection, &sample("a/notes.md")).unwrap();
        create(&connection, &sample("b/other.md")).unwrap();

        assert_eq!(all(&connection).unwrap().len(), 2);
    }
}
