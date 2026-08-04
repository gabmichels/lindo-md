import { ThemeFileSchema, ThemeSchema, type Theme } from "./schema";

/**
 * Themes as files: the format users share, and the reason the `Theme` schema
 * lives on the frontend rather than being split across Rust and TypeScript.
 */

const FORMAT = "pretty-md-theme" as const;
const VERSION = 1 as const;

export function serializeTheme(theme: Theme): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, theme }, null, 2);
}

export interface ImportResult {
  theme: Theme | null;
  error: string | null;
}

/**
 * Parses a theme file. Returns the problem rather than throwing, because the
 * caller is a file picker and "that file is not a theme" is an ordinary outcome,
 * not an exception.
 */
export function parseThemeFile(contents: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return { theme: null, error: "That file is not valid JSON." };
  }

  const file = ThemeFileSchema.safeParse(parsed);
  if (file.success) return { theme: file.data.theme, error: null };

  // A bare theme object, without the wrapper, is a reasonable thing to hand us —
  // someone will paste the `theme` key's value out of an exported file.
  const bare = ThemeSchema.safeParse(parsed);
  if (bare.success) return { theme: bare.data, error: null };

  return {
    theme: null,
    error: `That file is not a pretty-md theme: ${describe(file.error.issues[0])}`,
  };
}

function describe(issue: { path: PropertyKey[]; message: string } | undefined): string {
  if (!issue) return "unknown problem";
  const path = issue.path.join(".");
  return path ? `${path} — ${issue.message}` : issue.message;
}

/**
 * Forks a theme into a user-owned copy. Editing any control does this rather
 * than mutating a preset: presets have to stay available unchanged, or "reset to
 * Nord" would have nothing to reset to.
 */
export function forkTheme(theme: Theme, existingIds: string[]): Theme {
  if (theme.id.startsWith("custom-")) return theme;

  let index = 1;
  let id = "custom-1";
  while (existingIds.includes(id)) {
    index += 1;
    id = `custom-${index}`;
  }

  return { ...theme, id, name: `${theme.name} (edited)` };
}
