import { z } from "zod";

import { EMPTY_SESSION, GROUP_COLORS, MAX_GROUP_NAME, normalize, type Session } from "./model";

/**
 * The persisted shape of a tab session.
 *
 * Rust stores this opaquely (see `src-tauri/src/config.rs`), so this file is
 * the only validator — which is why it ends in `normalize`, and why a session
 * it cannot parse degrades to an empty one instead of throwing. `config.json`
 * also holds the reader's custom themes, and a hand-edited tab list must not be
 * able to take those down with it.
 */

const TabSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  groupId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  preview: z.boolean().default(false),
  openerId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
});

const TabGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(MAX_GROUP_NAME).default(""),
  color: z.enum(GROUP_COLORS),
  collapsed: z.boolean().default(false),
});

export const SessionSchema = z.object({
  tabs: z.array(TabSchema),
  groups: z.array(TabGroupSchema),
  activeTabId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
});

/** Parses whatever was in `config.json`, repairing it or falling back to empty.
 *  Never throws and never rejects — the window has to open either way. */
export const StoredSessionSchema = z.unknown().transform((value): Session => {
  const parsed = SessionSchema.safeParse(value);
  return parsed.success ? normalize(parsed.data) : EMPTY_SESSION;
});
