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

/// All three, and `Cr` is not there for completeness.
///
/// comrak ends a line on a bare `\r` exactly as it does on `\n` (CommonMark says
/// so), but `srcmap::LineIndex` finds line starts by counting `'\n'` alone. One
/// stray `\r` therefore slides comrak's line numbers one ahead of the map's, and
/// `data-sourcepos` stops describing the bytes it claims to: two paragraphs get
/// handed the same source range, and an edit to the second rewrites the first.
/// Further down the same path `align_block` slices `&source[start..end]` on a
/// mis-derived offset, which panics if it lands mid-character — and `panic =
/// "abort"` means that takes the window down with every open tab.
///
/// Normalizing it away here is what makes this module's promise true rather than
/// nearly true. A file that really is CR-terminated is still written back that way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
}

impl LineEnding {
    /// Whichever ending the file mostly uses. A file with no newline at all is
    /// `Lf`, which only decides what a *future* newline looks like, and a tie goes
    /// to `Lf` for the same reason.
    fn detect(text: &str) -> Self {
        let crlf = text.matches("\r\n").count();
        // Both counts are of *lone* endings: every `\r\n` contains one of each, so
        // subtracting it is what stops a CRLF file reading as a tie between three.
        let lf = text.matches('\n').count() - crlf;
        let cr = text.matches('\r').count() - crlf;

        if crlf > lf && crlf > cr {
            Self::Crlf
        } else if cr > lf && cr > crlf {
            Self::Cr
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
    // Before the UTF-16LE check, because a UTF-32LE BOM *starts with* one. Left to
    // fall through, `\xFF\xFE\0\0` decodes as UTF-16 into NUL-riddled mojibake that
    // `String::from_utf16` accepts without complaint — a silently wrong document,
    // which is the one outcome this function refuses to produce.
    if bytes.starts_with(&[0xFF, 0xFE, 0x00, 0x00]) || bytes.starts_with(&[0x00, 0x00, 0xFE, 0xFF])
    {
        return None;
    }

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
        LineEnding::Cr => std::borrow::Cow::Owned(normalized.replace('\n', "\r")),
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
///
/// **This has to be idempotent, and handling the lone `\r` is what makes it so.**
/// `save` hashes the normalized string and then hands it to `encode`, which
/// normalizes again; if the second pass could still change something, the hash
/// would describe a string that never reached the disk. Every consequence of that
/// is severe and none of them says so: `is_our_write` stops recognising the
/// reader's own save and reloads the document under their caret, and
/// `ensure_unchanged` then refuses every later save as a `StaleWrite` — telling
/// them the file changed underneath them when nothing touched it. Collapsing only
/// `\r\n` is not idempotent, because `"\r\r\n"` becomes `"\r\n"`.
pub fn normalize(text: &str) -> std::borrow::Cow<'_, str> {
    if text.contains('\r') {
        std::borrow::Cow::Owned(text.replace("\r\n", "\n").replace('\r', "\n"))
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

    /// A `\r` reaching comrak slides its line numbering one ahead of
    /// `srcmap::LineIndex`, which counts `'\n'` alone — so `data-sourcepos` starts
    /// describing bytes it does not own, and an edit lands on the wrong paragraph.
    /// It never gets that far now.
    #[test]
    fn no_carriage_return_survives_decoding() {
        for bytes in [
            b"a\rb\n".as_slice(),
            b"a\r\rb\n".as_slice(),
            b"a\r\r\nb".as_slice(),
            b"\xFF\xFEa\x00\r\x00b\x00".as_slice(),
        ] {
            let (text, _) = decode(bytes).expect("text");
            assert!(!text.contains('\r'), "a \\r reached the renderer: {text:?}");
        }
    }

    #[test]
    fn a_classic_mac_file_is_written_back_with_its_own_endings() {
        round_trips(b"a\rb\rc\r");

        let (text, form) = decode(b"a\rb\r").expect("text");
        assert_eq!(text, "a\nb\n");
        assert_eq!(form.line_ending, LineEnding::Cr);
    }

    /// `save` hashes the normalized string and then `encode` normalizes it again.
    /// A second pass that still changed something would leave the recorded hash
    /// describing a string that never reached the disk — see `normalize`.
    #[test]
    fn normalizing_twice_is_normalizing_once() {
        for text in ["a\r\r\nb", "a\r\nb", "a\rb", "a\n\r\r\n\nb", "plain"] {
            let once = normalize(text).into_owned();
            assert_eq!(normalize(&once), once, "not idempotent for {text:?}");
        }
    }

    /// The same property from the caller's side: what `save` hashes is what
    /// `encode` writes, so `is_our_write` recognises the write and the next
    /// `ensure_unchanged` does not report a `StaleWrite` on a file nobody touched.
    #[test]
    fn what_is_hashed_is_what_is_written() {
        let form = TextForm {
            bom: Bom::None,
            line_ending: LineEnding::Lf,
        };
        // As it arrives from a paste, before `save` has normalized it.
        let hashed = normalize("a\r\r\nb").into_owned();
        let written = encode(&hashed, form);
        assert_eq!(String::from_utf8(written).expect("utf-8"), hashed);
    }

    /// A UTF-32LE BOM opens with the same two bytes as UTF-16LE, and decoding it
    /// as UTF-16 produces mojibake `String::from_utf16` is happy to accept.
    #[test]
    fn utf32_is_refused_rather_than_read_as_utf16() {
        assert!(decode(b"\xFF\xFE\x00\x00A\x00\x00\x00").is_none());
        assert!(decode(b"\x00\x00\xFE\xFF\x00\x00\x00A").is_none());
    }
}
