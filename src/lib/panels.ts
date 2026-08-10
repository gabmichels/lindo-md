/**
 * The resizable chrome columns: the rail on the left, the notes panel on the
 * right.
 *
 * The band is mirrored from `PANEL_WIDTH_MIN` / `PANEL_WIDTH_MAX` in
 * `src-tauri/src/config.rs`, which clamps whatever reaches disk. Both copies
 * exist because the drag has to clamp live, in the browser, and a round trip to
 * Rust per pointer move is not a thing anyone would ship. `panels.test.ts` reads
 * the Rust constants and fails if the two drift.
 */

export const PANEL_MIN = 200;
export const PANEL_MAX = 420;

/** The widths a double-click on a handle returns a column to. */
export const RAIL_DEFAULT = 264;
export const NOTES_DEFAULT = 248;
