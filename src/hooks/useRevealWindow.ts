import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

/**
 * Shows the window, once there is something worth looking at in it.
 *
 * The window is created hidden (`visible: false` in `tauri.conf.json`) because
 * two things happen just after it would otherwise appear: the window-state
 * plugin resizes it to the geometry of the last session, and the config arrives
 * from disk. Showing it before both meant the reader watched an empty window at
 * the default 1240x860 flash white and then jump to their real size.
 *
 * `ready` is the config having loaded; the two frames are the paint of the
 * render that loading caused. Rust shows the window anyway a few seconds in
 * (see `lib.rs`), so a frontend that never reaches here fails visibly rather
 * than as a process with no window.
 */
export function useRevealWindow(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;

    // The first callback runs before the paint of the render that set `ready`;
    // the second runs after it.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const window = getCurrentWindow();
        // Shown, then focused: a window that starts hidden is not the foreground
        // window when it appears, so keyboard shortcuts would go elsewhere until
        // the reader clicked it. Failures here are not worth reporting — the
        // backstop in Rust shows the window regardless.
        void window
          .show()
          .then(() => window.setFocus())
          .catch(() => undefined);
      });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [ready]);
}
