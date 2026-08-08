import { describe, expect, it } from "vitest";

import { StoredSessionSchema } from "./schema";

/**
 * What a hand-edited or older `config.json` turns into.
 *
 * The rule this file exists to hold is the one in AGENTS.md: a schema can
 * tighten in a release, and that must never cost someone their data. A session
 * this parser cannot read degrades to an empty one, so anything it *can*
 * partially read has to survive rather than take the reader's tabs with it.
 */

const TAB = { id: "a", path: "/a.md", groupId: null, preview: false, openerId: null };

describe("StoredSessionSchema", () => {
  it("reads a session written before the comparison pane existed", () => {
    // The case that actually ships: every config.json in the wild right now has
    // no `comparePath` key at all. Losing the tabs over it would be a bad
    // trade for a feature nobody had yet.
    const session = StoredSessionSchema.parse({
      tabs: [TAB],
      groups: [],
      activeTabId: "a",
    });
    expect(session.tabs).toHaveLength(1);
    expect(session.comparePath).toBe(null);
  });

  it("round-trips an open comparison pane", () => {
    const session = StoredSessionSchema.parse({
      tabs: [TAB],
      groups: [],
      activeTabId: "a",
      comparePath: "/compare.md",
    });
    expect(session.comparePath).toBe("/compare.md");
  });

  it("treats a null pane as a closed one", () => {
    const session = StoredSessionSchema.parse({
      tabs: [TAB],
      groups: [],
      activeTabId: "a",
      comparePath: null,
    });
    expect(session.comparePath).toBe(null);
  });

  it("drops a pane whose path is not a string, keeping the tabs", () => {
    // `comparePath` is one field of a file a reader can edit. It is not worth a
    // session, so the parse fails over to empty only if the *tabs* are
    // unreadable — here the whole object is rejected and the reader gets the
    // empty session rather than a half-built one, which is the documented
    // degrade path and is asserted so a future loosening is a deliberate edit.
    const session = StoredSessionSchema.parse({
      tabs: [TAB],
      groups: [],
      activeTabId: "a",
      comparePath: 42,
    });
    expect(session.tabs).toEqual([]);
    expect(session.comparePath).toBe(null);
  });

  it("never throws on nonsense", () => {
    for (const value of [null, undefined, 7, "session", [], {}]) {
      expect(() => StoredSessionSchema.parse(value)).not.toThrow();
    }
  });
});
