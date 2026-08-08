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

/**
 * Named text sizes — large print, reachable in one click.
 *
 * The stepper in Settings and `Ctrl` `+` already reach every one of these
 * values, and neither is any use to the reader who needs them most: a stepper
 * asks you to find a dialog, count clicks and read a percentage, which is three
 * demands on someone who came here because the text was too small to read. A
 * named size is one press, in the panel that is already open, with the document
 * behind it changing as you press.
 *
 * These are *zoom* values rather than a typography setting, which is what makes
 * them safe to offer. Zoom scales the theme's own size and is not part of the
 * theme, so picking Largest does not fork the preset into a custom copy, does
 * not travel with an exported theme file, and is undone by picking Standard
 * again — none of which would be true of writing `baseSize`. It also caps at
 * 28px, which is below where this needs to reach.
 *
 * Three, and matching the widths above them, because a panel of segmented trios
 * is scannable and a fourth option here would be split hairs: everything
 * between and beyond is still the stepper's job.
 */
export const READING_SIZES: readonly {
  value: string;
  label: string;
  zoom: number;
  title: string;
}[] = [
  { value: "standard", label: "Standard", zoom: 1, title: "The theme's own size" },
  { value: "large", label: "Large", zoom: 1.3, title: "A third larger — 130%" },
  { value: "largest", label: "Largest", zoom: 1.6, title: "Large print — 160%" },
];
