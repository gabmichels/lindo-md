import { useCallback, useEffect, useRef, useState } from "react";

import { useConfig } from "@/hooks/useConfig";
import {
  EMPTY_SESSION,
  activateRelative,
  activateTab,
  addToGroup,
  closeGroup,
  closeOthers,
  closeTab,
  closeToRight,
  groupTabs,
  moveGroup,
  moveTab,
  openTab,
  promotePreview,
  recolorGroup,
  removeFromGroup,
  renameGroup,
  setGroupCollapsed,
  setTabPath,
  ungroup,
  type GroupColor,
  type MoveIntent,
  type Session,
} from "@/lib/tabs/model";

/**
 * Owns the tab session and persists it.
 *
 * Every operation is a call into `lib/tabs/model`, which is pure — this hook
 * only holds the current session, hydrates it from the config once at startup,
 * and writes it back. All the rules about ordering and grouping live in the
 * model, where they can be tested without React.
 */

export interface ClosedTab {
  path: string;
  index: number;
}

export interface TabsState {
  session: Session;
  /** Opens a file, or activates it if already open. Returns the tab's id. */
  open: (
    path: string,
    options?: { preview?: boolean; openerId?: string | null },
  ) => string;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  closeToRight: (id: string) => void;
  closeGroup: (groupId: string) => void;
  activate: (id: string) => void;
  cycle: (delta: number) => void;
  /** Activates the nth visible tab, or the last one for `Ctrl+9`. */
  activateIndex: (index: number | "last") => void;
  promote: (id: string) => void;
  /** Re-points a tab at another document, when a link is followed inside it. */
  setPath: (id: string, path: string) => void;
  move: (id: string, toSeam: number, intent?: MoveIntent) => void;
  moveGroup: (groupId: string, toSeam: number) => void;
  group: (ids: string[], init?: { name?: string; color?: GroupColor }) => string;
  ungroup: (groupId: string) => void;
  removeFromGroup: (id: string) => void;
  addToGroup: (id: string, groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  recolorGroup: (groupId: string, color: GroupColor) => void;
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  /** Reopens the most recently closed tab, browser-style. */
  reopenClosed: () => void;
  newId: () => string;
}

function newId(): string {
  return crypto.randomUUID();
}

/** How many closed tabs Ctrl+Shift+T can walk back through. */
const UNDO_DEPTH = 10;

export function useTabs(): TabsState {
  const { config, loaded, update } = useConfig();
  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const closed = useRef<ClosedTab[]>([]);

  // Held in a ref as well as state so a sequence of operations inside one tick
  // composes correctly instead of each starting from the same stale session.
  const current = useRef(session);

  const hydrated = useRef(false);
  useEffect(() => {
    if (!loaded || hydrated.current) return;
    hydrated.current = true;

    // Anything already open when the config arrives was opened before the
    // restore could run — a document the OS handed us at launch, typically.
    // It is folded into the restored session rather than replaced by it: a
    // plain assignment here silently loses the file the reader double-clicked.
    const early = current.current.tabs;
    const next = early.reduce(
      (session, tab) => openTab(session, tab.path, { id: tab.id }),
      config.session,
    );

    current.current = next;
    setSession(next);
    if (early.length > 0) update({ session: next });
  }, [loaded, config.session, update]);

  const apply = useCallback(
    (change: (session: Session) => Session) => {
      const next = change(current.current);
      if (next === current.current) return;
      current.current = next;
      setSession(next);
      // `update` is already debounced, so dragging a tab across the strip does
      // not write config.json on every frame.
      update({ session: next });
    },
    [update],
  );

  const remember = useCallback((id: string) => {
    const session = current.current;
    const index = session.tabs.findIndex((tab) => tab.id === id);
    const tab = session.tabs[index];
    if (!tab) return;
    closed.current = [{ path: tab.path, index }, ...closed.current].slice(
      0,
      UNDO_DEPTH,
    );
  }, []);

  return {
    session,

    open: useCallback(
      (path, options) => {
        const existing = current.current.tabs.find((tab) => tab.path === path);
        const id = existing?.id ?? newId();
        apply((session) =>
          openTab(session, path, {
            id,
            preview: options?.preview,
            openerId: options?.openerId ?? null,
          }),
        );
        return id;
      },
      [apply],
    ),

    close: useCallback(
      (id) => {
        remember(id);
        apply((session) => closeTab(session, id));
      },
      [apply, remember],
    ),

    closeOthers: useCallback((id) => apply((s) => closeOthers(s, id)), [apply]),
    closeToRight: useCallback((id) => apply((s) => closeToRight(s, id)), [apply]),
    closeGroup: useCallback((id) => apply((s) => closeGroup(s, id)), [apply]),

    activate: useCallback((id) => apply((s) => activateTab(s, id)), [apply]),
    cycle: useCallback((delta) => apply((s) => activateRelative(s, delta)), [apply]),

    activateIndex: useCallback(
      (index) => {
        apply((session) => {
          const visible = session.tabs.filter((tab) => {
            const group = tab.groupId
              ? session.groups.find((candidate) => candidate.id === tab.groupId)
              : undefined;
            return !group?.collapsed;
          });
          const tab = index === "last" ? visible.at(-1) : visible[index];
          return tab ? activateTab(session, tab.id) : session;
        });
      },
      [apply],
    ),

    promote: useCallback((id) => apply((s) => promotePreview(s, id)), [apply]),
    setPath: useCallback(
      (id, path) => apply((s) => setTabPath(s, id, path)),
      [apply],
    ),

    move: useCallback(
      (id, toSeam, intent) => apply((s) => moveTab(s, id, toSeam, intent)),
      [apply],
    ),
    moveGroup: useCallback(
      (groupId, toSeam) => apply((s) => moveGroup(s, groupId, toSeam)),
      [apply],
    ),

    group: useCallback(
      (ids, init) => {
        const id = newId();
        apply((session) => groupTabs(session, ids, { id, ...init }));
        return id;
      },
      [apply],
    ),

    ungroup: useCallback((groupId) => apply((s) => ungroup(s, groupId)), [apply]),
    removeFromGroup: useCallback(
      (id) => apply((s) => removeFromGroup(s, id)),
      [apply],
    ),
    addToGroup: useCallback(
      (id, groupId) => apply((s) => addToGroup(s, id, groupId)),
      [apply],
    ),
    renameGroup: useCallback(
      (groupId, name) => apply((s) => renameGroup(s, groupId, name)),
      [apply],
    ),
    recolorGroup: useCallback(
      (groupId, color) => apply((s) => recolorGroup(s, groupId, color)),
      [apply],
    ),
    setGroupCollapsed: useCallback(
      (groupId, collapsed) => apply((s) => setGroupCollapsed(s, groupId, collapsed)),
      [apply],
    ),

    reopenClosed: useCallback(() => {
      const [last, ...rest] = closed.current;
      if (!last) return;
      closed.current = rest;
      apply((session) =>
        openTab(session, last.path, { id: newId(), at: last.index }),
      );
    }, [apply]),

    newId,
  };
}
