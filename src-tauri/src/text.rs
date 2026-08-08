//! Turning a file's bytes into the one string shape the rest of the app works in,
//! and putting them back the way they were found.
//!
//! Everything above this module — comrak, `srcmap`, `data-sourcepos`, every edit in
//! `src/lib/edit/` — assumes a string whose lines end in `\n` and which starts with
//! real content. That assumption was previously just *hoped for*: `read_to_string`
//! hands back whatever was in the file, so a CRLF document reached an editor that
//! only ever inserts `\n`, and one keystroke was enough to leave a file with two
//! kinds of line ending and a diff touching lines nobody edited.
//!
//! So the normalization happens here, in one place, and is undone here too. A
//! [`TextForm`] records how the file was written; `decode` strips that form off and
//! `encode` puts it back, which is what keeps a save byte-identical to what was
//! opened when the reader changed nothing.
//!
//! **The one case that does not round-trip byte for byte is a file whose line
//! endings are already mixed.** It is normalized to whichever ending dominates, so
//! saving it unifies the rest of the file as well as applying the edit. Preserving
//! mixed endings would mean tracking an ending per line through every edit, for a
//! file shape that is itself the bug this module exists to stop creating.

/// A byte-order mark, which is both an encoding and something to put back.
///
/// UTF-16 is here because Windows produces it without anyone asking: Notepad's
/// old "Unicode" option and `>` redirection in Windows PowerShell 5 both write
/// it. Those files used to fail to open at all — `read_to_string` rejects them —
/// which reads as lindo-md being broken rather than as the file being unusual.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bom {
    None,
    Utf8,
    Utf16Le,
    Utf16Be,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnding {
    Lf,
    Crlf,
}

impl LineEnding {
    /// Whichever ending the file mostly uses. A file with no newline at all is
    /// `Lf`, which only decides what a *future* newline looks like.
    fn detect(text: &str) -> Self {
        let crlf = text.matches("\r\n").count();
        let lone_lf = text.matches('\n').count() - crlf;
        if crlf > lone_lf {
            Self::Crlf
        } else {
            Self::Lf
        }
    }
}

/// How a file was written, so it can be written that way again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextForm {
    pub bom: Bom,
    pub line_ending: LineEnding,
}

/// Reads bytes as text, returning the content with `\n` endings and no BOM,
/// alongside the form needed to write it back unchanged.
///
/// `None` means these bytes are not text this app can read: not valid UTF-8, and
/// not UTF-16 announced by a BOM. Guessing a legacy code page is deliberately not
/// attempted — a wrong guess renders a document that is subtly, silently wrong,
/// which is worse for a viewer whose whole claim is fidelity than refusing it.
pub fn decode(bytes: &[u8]) -> Option<(String, TextForm)> {
    let (text, bom) = if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        (std::str::from_utf8(rest).ok()?.to_owned(), Bom::Utf8)
    } else if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        (from_utf16(rest, u16::from_le_bytes)?, Bom::Utf16Le)
    } else if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        (from_utf16(rest, u16::from_be_bytes)?, Bom::Utf16Be)
    } else {
        (std::str::from_utf8(bytes).ok()?.to_owned(), Bom::None)
    };

    let line_ending = LineEnding::detect(&text);
    Some((normalize(&text).into_owned(), TextForm { bom, line_ending }))
}

/// Writes text back in the form it was read in.
///
/// Normalizes first rather than trusting the caller, because the string arriving
/// from the webview is not only what `decode` produced: a reader can paste CRLF
/// text into a LF document. Expanding that without normalizing would write `\r\r\n`.
pub fn encode(text: &str, form: TextForm) -> Vec<u8> {
    let normalized = normalize(text);
    let restored = match form.line_ending {
        LineEnding::Lf => normalized,
        LineEnding::Crlf => std::borrow::Cow::Owned(normalized.replace('\n', "\r\n")),
    };

    match form.bom {
        Bom::None => restored.into_owned().into_bytes(),
        Bom::Utf8 => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(restored.as_bytes());
            out
        }
        Bom::Utf16Le => to_utf16(&restored, [0xFF, 0xFE], u16::to_le_bytes),
        Bom::Utf16Be => to_utf16(&restored, [0xFE, 0xFF], u16::to_be_bytes),
    }
}

/// Every line ending as `\n`. Borrows when there is nothing to do, which is the
/// common case and the one on the save path.
pub fn normalize(text: &str) -> std::borrow::Cow<'_, str> {
    if text.contains("\r\n") {
        std::borrow::Cow::Owned(text.replace("\r\n", "\n"))
    } else {
        std::borrow::Cow::Borrowed(text)
    }
}

/// `None` on an odd byte count or an unpaired surrogate — either means this is not
/// the UTF-16 its BOM claimed.
fn from_utf16(bytes: &[u8], word: fn([u8; 2]) -> u16) -> Option<String> {
    let pairs = bytes.chunks_exact(2);
    if !pairs.remainder().is_empty() {
        return None;
    }
    let units: Vec<u16> = pairs
        .map(|pair| <[u8; 2]>::try_from(pair).map(word))
        .collect::<Result<_, _>>()
        .ok()?;
    String::from_utf16(&units).ok()
}

fn to_utf16(text: &str, bom: [u8; 2], word: fn(u16) -> [u8; 2]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bom.len() + text.len() * 2);
    out.extend_from_slice(&bom);
    for unit in text.encode_utf16() {
        out.extend_from_slice(&word(unit));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The property the whole module exists for: open a file, change nothing, save
    /// it, and the bytes on disk are the bytes that were there before.
    fn round_trips(bytes: &[u8]) {
        let (text, form) = decode(bytes).expect("these bytes are text");
        assert_eq!(
            encode(&text, form),
            bytes,
            "re-encoding changed a file nobody edited"
        );
    }

    #[test]
    fn a_file_that_is_not_edited_is_written_back_unchanged() {
        round_trips(b"# Title\n\nA line.\n");
        round_trips(b"# Title\r\n\r\nA line.\r\n");
        round_trips(b"\xEF\xBB\xBF# Title\r\nA line.\r\n");
        round_trips(b"\xEF\xBB\xBF# Title\nA line.\n");
        round_trips(b"\xFF\xFE#\x00 \x00A\x00\r\x00\n\x00");
        round_trips(b"\xFE\xFF\x00#\x00 \x00A\x00\r\x00\n");
        round_trips(b"");
    }

    #[test]
    fn decoding_hands_back_lf_whatever_the_file_used() {
        let (text, form) = decode(b"a\r\nb\r\n").expect("text");
        assert_eq!(text, "a\nb\n");
        assert_eq!(form.line_ending, LineEnding::Crlf);
        assert_eq!(form.bom, Bom::None);
    }

    #[test]
    fn a_bom_is_content_to_nobody_above_this_module() {
        let (text, form) = decode(b"\xEF\xBB\xBF# Title\n").expect("text");
        assert_eq!(text, "# Title\n", "the BOM must not reach comrak as text");
        assert_eq!(form.bom, Bom::Utf8);
    }

    #[test]
    fn utf16_opens_at_all() {
        // Windows PowerShell 5's `>` writes this; `read_to_string` refuses it.
        let (text, _) = decode(b"\xFF\xFEh\x00i\x00").expect("text");
        assert_eq!(text, "hi");
    }

    /// An edit inserts `\n` — everything above this module only knows that one —
    /// and the file still has to come back in its own endings.
    #[test]
    fn an_edit_written_into_a_crlf_file_stays_crlf() {
        let (text, form) = decode(b"a\r\nb\r\n").expect("text");
        let edited = format!("{text}c\n");
        assert_eq!(encode(&edited, form), b"a\r\nb\r\nc\r\n");
    }

    /// Pasting CRLF text into a LF document must not produce `\r\r\n`, and pasting
    /// it into a CRLF document must not double up either.
    #[test]
    fn pasted_endings_are_unified_rather_than_compounded() {
        let lf = TextForm {
            bom: Bom::None,
            line_ending: LineEnding::Lf,
        };
        assert_eq!(encode("a\r\nb\r\n", lf), b"a\nb\n");

        let crlf = TextForm {
            bom: Bom::None,
            line_ending: LineEnding::Crlf,
        };
        assert_eq!(encode("a\r\nb\n", crlf), b"a\r\nb\r\n");
    }

    #[test]
    fn the_dominant_ending_wins_a_mixed_file() {
        let (_, form) = decode(b"a\r\nb\r\nc\n").expect("text");
        assert_eq!(form.line_ending, LineEnding::Crlf);

        let (_, form) = decode(b"a\nb\nc\r\n").expect("text");
        assert_eq!(form.line_ending, LineEnding::Lf);
    }

    #[test]
    fn bytes_that_are_not_text_are_refused_rather_than_guessed() {
        // Windows-1252 "café" — valid in its own code page, invalid UTF-8.
        assert!(decode(b"caf\xE9").is_none());
        // A UTF-16 BOM followed by an odd number of bytes.
        assert!(decode(b"\xFF\xFEa").is_none());
        // An unpaired surrogate: a lead with no trail.
        assert!(decode(b"\xFF\xFE\x00\xD8").is_none());
    }

    /// A lone `\r` is a classic-Mac ending and is left exactly as it is: not
    /// normalized, so not re-expanded either.
    #[test]
    fn a_lone_carriage_return_is_left_alone() {
        round_trips(b"a\rb\n");
    }
}
