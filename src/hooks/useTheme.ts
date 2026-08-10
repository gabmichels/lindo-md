import { useEffect, useMemo, useState } from "react";

import type { AppearanceMode } from "@/lib/ipc";
import { applyTheme, type DocView } from "@/lib/theme/apply";
import { applyChrome } from "@/lib/theme/chrome";
import { resolveTheme } from "@/lib/theme/presets";
import type { Appearance, Theme } from "@/lib/theme/schema";

/**
 * Resolves the settings into the active theme and writes it to the window: the
 * paper onto the document canvas, the tool onto the root element.
 *
 * Two writes rather than one, onto two elements, because the namespaces have
 * different scopes. `--doc-*` belongs to the canvas — that is what lets a themed
 * card inside a themed page override cleanly, since custom properties inherit
 * and the nearest themed ancestor wins. `--ui-*` belongs to the root, because
 * the chrome is spread across the whole window: the rail, the titlebar, and
 * every dialog Radix portals out to `<body>`, which is not inside the canvas and
 * never will be.
 *
 * The tool still is not made of the paper — see `chrome.ts` — but it is now
 * derived from it, so both move together (DESIGN.md).
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
  view: DocView,
): Theme {
  const systemAppearance = useSystemAppearance();
  const appearance: Appearance = mode === "system" ? systemAppearance : mode;

  const theme = useMemo(
    () => resolveTheme(themeId, appearance, customThemes),
    [themeId, appearance, customThemes],
  );

  // Destructured so the effect depends on the view's values rather than on the
  // identity of an object App.tsx rebuilds on every render.
  const { zoom, contentWidth } = view;

  useEffect(() => {
    if (canvas) applyTheme(theme, canvas, { zoom, contentWidth });
  }, [theme, canvas, zoom, contentWidth]);

  // Not gated on the canvas: the chrome is there from the first paint, and a
  // window with no document open still has a rail to colour.
  useEffect(() => {
    applyChrome(theme, document.documentElement);
  }, [theme]);

  return theme;
}
