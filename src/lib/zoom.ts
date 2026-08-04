/**
 * The reader's zoom, and the one place its bounds are written down.
 *
 * Mirrors `ZOOM_RANGE` in `src-tauri/src/config.rs`, which clamps the same
 * numbers on load — a config file edited by hand must not be able to push the
 * document past what the UI can walk back.
 */

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.1;

/**
 * One step from `current`, bounded.
 *
 * Rounded to a tenth because the steps are tenths: adding 0.1 in binary floating
 * point drifts (0.7 + 0.1 = 0.7999999999999999), and without this the read-out
 * shows 80% while the stored value is not the 0.8 the next step assumes.
 */
export function stepZoom(current: number, delta: number): number {
  return clampZoom(Math.round((current + delta) * 10) / 10);
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}
