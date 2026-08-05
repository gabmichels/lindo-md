import { useEffect, useMemo, useState } from "react";

import type { AppearanceMode } from "@/lib/ipc";
import { applyTheme } from "@/lib/theme/apply";
import { resolveTheme } from "@/lib/theme/presets";
import type { Appearance, Theme } from "@/lib/theme/schema";

/**
 * Resolves the settings into the active theme and writes it to the document
 * canvas.
 *
 * Only `--doc-*` properties are written, and only onto the canvas element — the
 * chrome's `--ui-*` tokens are static in `styles.css` and are never touched from
 * here. That separation is what lets the paper change without the tool changing
 * (DESIGN.md).
 */

export function useSystemAppearance(): Appearance {
  const [appearance, setAppearance] = useState<Appearance>(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setAppearance(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  return appearance;
}

export function useTheme(
  themeId: string,
  mode: AppearanceMode,
  customThemes: Theme[],
  canvas: HTMLElement | null,
  zoom: number,
): Theme {
  const systemAppearance = useSystemAppearance();
  const appearance: Appearance = mode === "system" ? systemAppearance : mode;

  const theme = useMemo(
    () => resolveTheme(themeId, appearance, customThemes),
    [themeId, appearance, customThemes],
  );

  useEffect(() => {
    if (canvas) applyTheme(theme, canvas, zoom);
  }, [theme, canvas, zoom]);

  return theme;
}
