/**
 * The tab session: what is open, in what order, and how it is grouped.
 *
 * Every function here is pure and free of React, because the awkward part of
 * tabs is not rendering them — it is that tab groups must stay *contiguous*
 * runs in a flat list while tabs are dragged in and out of them. That rule is
 * easy to state and easy to break, so it lives in one file with one repair
 * function (`normalize`) and a test for every way it can be violated.
 *
 * The shape of every mutator is the same: **remove the tab first, then insert
 * it at a clamped seam.** Removing first means the two halves of the run it
 * left become adjacent before any insertion math happens, so a group with a
 * hole in it is never even representable.
 */

/** An insertion point in `tabs`. Seam `i` means "before index `i`", so the
 *  legal seams of a list of length `n` are `0..n`. A group occupying indices
 *  `[a, b]` has *interior* seams `a+1 … b` and *boundary* seams `a` and `b+1`;
 *  dropping a tab on an interior seam puts it inside the group. */
type Seam = number;

export const GROUP_COLORS = [
  "clay",
  "amber",
  "moss",
  "teal",
  "slate",
  "indigo",
  "plum",
  "rose",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export const MAX_GROUP_NAME = 60;

export interface Tab {
  id: string;
  path: string;
  groupId: string | null;
  /** The VS Code-style preview tab: italic, and replaced by the next single
   *  click in the rail instead of accumulating. At most one per session. */
  preview: boolean;
  /** The tab this one was opened from, if it came from a link. Used to pick
   *  what to activate when this tab closes, so following a link and closing it
   *  again returns you where you were rather than to an arbitrary neighbour. */
  openerId: string | null;
}

export interface TabGroup {
  id: string;
  /** May be empty — an unnamed group renders as a bare coloured pill, which is
   *  what you get if you dismiss the naming dialog. */
  name: string;
  color: GroupColor;
  collapsed: boolean;
}

export interface Session {
  /** The flat order. Index in this array *is* the visual order — there is no
   *  second ordering anywhere, which is what keeps the two from desyncing. */
  tabs: Tab[];
  /** Order is meaningless here; a group's position comes from its members. */
  groups: TabGroup[];
  activeTabId: string | null;
}

export const EMPTY_SESSION: Session = { tabs: [], groups: [], activeTabId: null };

// --- reading ----------------------------------------------------------------

export function indexOfTab(session: Session, id: string): number {
  return session.tabs.findIndex((tab) => tab.id === id);
}

export function tabById(session: Session, id: string): Tab | undefined {
  return session.tabs.find((tab) => tab.id === id);
}

export function tabByPath(session: Session, path: string): Tab | undefined {
  return session.tabs.find((tab) => tab.path === path);
}

export function groupById(session: Session, id: string): TabGroup | undefined {
  return session.groups.find((group) => group.id === id);
}

export function activeTab(session: Session): Tab | undefined {
  return session.activeTabId ? tabById(session, session.activeTabId) : undefined;
}

/** The inclusive index range a group occupies, or `null` if it has no members.
 *  On a normalized session this range is contiguous. */
export function groupRange(
  session: Session,
  groupId: string,
): { start: number; end: number } | null {
  return rangeIn(session.tabs, groupId);
}

export function groupMembers(session: Session, groupId: string): Tab[] {
  return session.tabs.filter((tab) => tab.groupId === groupId);
}

/** Tabs that are actually drawn: everything except the members of a collapsed
 *  group, which are represented by their pill alone. */
export function visibleTabs(session: Session): Tab[] {
  const collapsed = new Set(
    session.groups.filter((group) => group.collapsed).map((group) => group.id),
  );
  return session.tabs.filter((tab) => tab.groupId === null || !collapsed.has(tab.groupId));
}

// --- opening and closing ----------------------------------------------------

export interface OpenOptions {
  /** Supplied by the caller rather than generated here, so the model stays pure
   *  and every test is deterministic. */
  id: string;
  preview?: boolean;
  openerId?: string | null;
  /** Force membership of this group, clamping the insertion into its run. */
  groupId?: string | null;
  /** Explicit seam. Defaults to just after the active tab, like a browser. */
  at?: Seam;
  activate?: boolean;
}

/**
 * Opens `path`, or activates it if it is already open.
 *
 * A path is never opened twice: this is a viewer, and two tabs on the same file
 * would show the same bytes and compete for the same live-reload.
 */
export function openTab(session: Session, path: string, options: OpenOptions): Session {
  const activate = options.activate ?? true;
  const preview = options.preview ?? false;

  const existing = tabByPath(session, path);
  if (existing) {
    // Re-opening permanently is how a preview tab gets promoted — double-click
    // or Ctrl+click on a file you are already previewing pins it.
    const tabs = preview
      ? session.tabs
      : session.tabs.map((tab) => (tab.id === existing.id ? { ...tab, preview: false } : tab));
    return normalize({
      ...session,
      tabs,
      activeTabId: activate ? existing.id : session.activeTabId,
    });
  }

  const opener = options.openerId ?? null;
  const fresh: Tab = {
    id: options.id,
    path,
    groupId: null,
    preview,
    openerId: opener,
  };

  // A preview open reuses the existing preview tab's slot and group rather than
  // adding one, which is the whole point of preview tabs: browsing a folder
  // must not leave a trail of tabs behind.
  const replacing = preview ? session.tabs.find((tab) => tab.preview) : undefined;
  if (replacing) {
    const tabs = session.tabs.map((tab) =>
      tab.id === replacing.id ? { ...fresh, groupId: replacing.groupId } : tab,
    );
    return normalize({
      ...session,
      tabs,
      activeTabId: activate ? fresh.id : session.activeTabId,
    });
  }

  const activeIndex = session.activeTabId ? indexOfTab(session, session.activeTabId) : -1;
  const requested = options.at ?? (activeIndex >= 0 ? activeIndex + 1 : session.tabs.length);
  let seam = clamp(requested, 0, session.tabs.length);

  let groupId: string | null = null;
  const forced = options.groupId ?? null;

  if (forced !== null && rangeIn(session.tabs, forced)) {
    const range = rangeIn(session.tabs, forced)!;
    seam = clamp(seam, range.start, range.end + 1);
    groupId = forced;
  } else {
    const host = groupAtInteriorSeam(session.tabs, seam);
    // A link followed from inside a group stays in that group; anything else
    // that happens to land mid-group is pushed out to the nearest edge rather
    // than silently joining a group the reader did not choose.
    const openerTab = opener ? tabById(session, opener) : undefined;
    if (host && openerTab?.groupId === host) {
      groupId = host;
    } else if (host) {
      seam = snapOutOfGroups(session.tabs, seam);
    }
  }

  const tabs = insertAt(session.tabs, seam, { ...fresh, groupId });
  return normalize({
    ...session,
    tabs,
    activeTabId: activate ? fresh.id : session.activeTabId,
  });
}

export function closeTab(session: Session, id: string): Session {
  const index = indexOfTab(session, id);
  if (index < 0) return session;

  const closing = session.tabs[index]!;
  const remaining = session.tabs.filter((tab) => tab.id !== id);
  const activeTabId =
    session.activeTabId === id
      ? nextActiveAfterClose(closing, remaining, index)
      : session.activeTabId;

  return normalize({ ...session, tabs: remaining, activeTabId });
}

export function closeOthers(session: Session, id: string): Session {
  if (indexOfTab(session, id) < 0) return session;
  return normalize({
    ...session,
    tabs: session.tabs.filter((tab) => tab.id === id),
    activeTabId: id,
  });
}

export function closeToRight(session: Session, id: string): Session {
  const index = indexOfTab(session, id);
  if (index < 0) return session;
  const tabs = session.tabs.slice(0, index + 1);
  const stillOpen = tabs.some((tab) => tab.id === session.activeTabId);
  return normalize({
    ...session,
    tabs,
    activeTabId: stillOpen ? session.activeTabId : id,
  });
}

export function closeGroup(session: Session, groupId: string): Session {
  const range = groupRange(session, groupId);
  if (!range) return session;

  const remaining = session.tabs.filter((tab) => tab.groupId !== groupId);
  const closedActive = groupMembers(session, groupId).some((tab) => tab.id === session.activeTabId);
  // The whole run leaves at once, so activation lands on whatever slid into the
  // range's first slot, or on the tab just before it.
  const activeTabId = closedActive
    ? ((remaining[range.start] ?? remaining[range.start - 1])?.id ?? null)
    : session.activeTabId;

  return normalize({
    ...session,
    tabs: remaining,
    groups: session.groups.filter((group) => group.id !== groupId),
    activeTabId,
  });
}

function nextActiveAfterClose(closed: Tab, remaining: Tab[], index: number): string | null {
  if (remaining.length === 0) return null;

  // The tab this one was opened from, if it is still around and in the same
  // group — following a link and closing it should return you where you were.
  const opener = closed.openerId ? remaining.find((tab) => tab.id === closed.openerId) : undefined;
  if (opener?.groupId === closed.groupId) return opener.id;

  // Otherwise prefer a surviving group-mate over the plain right neighbour, so
  // closing through a group feels like staying inside it rather than escaping.
  if (closed.groupId !== null) {
    const right = remaining[index];
    if (right?.groupId === closed.groupId) return right.id;
    const left = remaining[index - 1];
    if (left?.groupId === closed.groupId) return left.id;
  }

  return (remaining[index] ?? remaining[index - 1])!.id;
}

// --- activation -------------------------------------------------------------

export function activateTab(session: Session, id: string): Session {
  if (indexOfTab(session, id) < 0) return session;
  // `normalize` expands the group if it was collapsed: an active tab nobody can
  // see means no tab looks selected and the window reads as dead.
  return normalize({ ...session, activeTabId: id });
}

/** Cycles by `delta` through the tabs that are actually on screen, wrapping at
 *  both ends. Members of a collapsed group are skipped — you cannot Ctrl+Tab to
 *  something that is not drawn. */
export function activateRelative(session: Session, delta: number): Session {
  const visible = visibleTabs(session);
  if (visible.length === 0) return session;

  const current = visible.findIndex((tab) => tab.id === session.activeTabId);
  const from = current < 0 ? 0 : current;
  const next = (((from + delta) % visible.length) + visible.length) % visible.length;
  return activateTab(session, visible[next]!.id);
}

/**
 * Points an existing tab at a different document — what following a link inside
 * a tab does. The tab keeps its identity, position and group.
 *
 * Refused if another tab already holds that path, because one file open twice
 * would show the same bytes in two places and compete for the same live-reload.
 * Callers activate the existing tab instead.
 */
export function setTabPath(session: Session, id: string, path: string): Session {
  const tab = tabById(session, id);
  if (!tab || tab.path === path) return session;
  if (session.tabs.some((other) => other.id !== id && other.path === path)) {
    return session;
  }
  return normalize({
    ...session,
    tabs: session.tabs.map((other) => (other.id === id ? { ...other, path } : other)),
  });
}

export function promotePreview(session: Session, id: string): Session {
  return normalize({
    ...session,
    tabs: session.tabs.map((tab) => (tab.id === id ? { ...tab, preview: false } : tab)),
  });
}

// --- moving -----------------------------------------------------------------

export type MoveIntent = { kind: "keep" } | { kind: "none" } | { kind: "join"; groupId: string };

/**
 * Moves a tab to a seam, deciding its group membership from `intent`.
 *
 * This is the one operation the drag layer calls, and the four cases that make
 * contiguity hard all resolve here — see the tests, which name each of them.
 */
export function moveTab(
  session: Session,
  id: string,
  toSeam: Seam,
  intent: MoveIntent = { kind: "keep" },
): Session {
  const index = indexOfTab(session, id);
  if (index < 0) return session;

  const tab = session.tabs[index]!;
  const rest = session.tabs.filter((t) => t.id !== id);
  // Removing shifts every seam to the right of the tab down by one.
  let seam = clamp(toSeam > index ? toSeam - 1 : toSeam, 0, rest.length);

  // `keep` degrades to `none` when the tab was the last member of its group:
  // there is no longer a run to rejoin.
  const resolved: MoveIntent =
    intent.kind === "keep"
      ? tab.groupId !== null && rangeIn(rest, tab.groupId)
        ? { kind: "join", groupId: tab.groupId }
        : { kind: "none" }
      : intent;

  let groupId: string | null = null;
  const target = resolved.kind === "join" ? rangeIn(rest, resolved.groupId) : null;

  if (resolved.kind === "join" && target) {
    seam = clamp(seam, target.start, target.end + 1);
    groupId = resolved.groupId;
  } else {
    seam = snapOutOfGroups(rest, seam);
  }

  return normalize({ ...session, tabs: insertAt(rest, seam, { ...tab, groupId }) });
}

/** Moves a whole group. The seam is snapped to one that is not interior to
 *  another group, which is what stops a pill from landing inside one. */
export function moveGroup(session: Session, groupId: string, toSeam: Seam): Session {
  const range = groupRange(session, groupId);
  if (!range) return session;

  const block = session.tabs.slice(range.start, range.end + 1);
  const rest = [...session.tabs.slice(0, range.start), ...session.tabs.slice(range.end + 1)];

  const shifted = toSeam > range.start ? toSeam - block.length : toSeam;
  const seam = snapOutOfGroups(rest, clamp(shifted, 0, rest.length));

  return normalize({
    ...session,
    tabs: [...rest.slice(0, seam), ...block, ...rest.slice(seam)],
  });
}

// --- grouping ---------------------------------------------------------------

export interface GroupInit {
  id: string;
  name?: string;
  color?: GroupColor;
}

/** Collects `ids` into a new group at the position of the leftmost one. */
export function groupTabs(session: Session, ids: string[], init: GroupInit): Session {
  const wanted = new Set(ids);
  const members = session.tabs.filter((tab) => wanted.has(tab.id));
  if (members.length === 0) return session;

  const anchor = indexOfTab(session, members[0]!.id);
  const rest = session.tabs.filter((tab) => !wanted.has(tab.id));
  // Every member removed from before the anchor pulls the seam left with it.
  const removedBefore = session.tabs.slice(0, anchor).filter((tab) => wanted.has(tab.id)).length;
  const seam = snapOutOfGroups(rest, clamp(anchor - removedBefore, 0, rest.length));

  const group: TabGroup = {
    id: init.id,
    name: (init.name ?? "").trim().slice(0, MAX_GROUP_NAME),
    color: init.color ?? nextColor(session),
    collapsed: false,
  };
  const block = members.map((tab) => ({ ...tab, groupId: group.id }));

  return normalize({
    ...session,
    tabs: [...rest.slice(0, seam), ...block, ...rest.slice(seam)],
    groups: [...session.groups, group],
  });
}

export function addToGroup(
  session: Session,
  id: string,
  groupId: string,
  side: "start" | "end" = "end",
): Session {
  const range = groupRange(session, groupId);
  if (!range) return session;
  const seam = side === "start" ? range.start : range.end + 1;
  return moveTab(session, id, seam, { kind: "join", groupId });
}

/** Lifts a tab out of its group, parking it immediately beside the run so the
 *  move reads as "out", not "to the far end of the strip". */
export function removeFromGroup(
  session: Session,
  id: string,
  side: "left" | "right" = "right",
): Session {
  const tab = tabById(session, id);
  if (!tab?.groupId) return session;
  const range = groupRange(session, tab.groupId);
  if (!range) return session;

  return moveTab(session, id, side === "left" ? range.start : range.end + 1, { kind: "none" });
}

/** Dissolves a group without moving anything: its members are already
 *  contiguous, so there is nothing to reorder. */
export function ungroup(session: Session, groupId: string): Session {
  return normalize({
    ...session,
    tabs: session.tabs.map((tab) => (tab.groupId === groupId ? { ...tab, groupId: null } : tab)),
    groups: session.groups.filter((group) => group.id !== groupId),
  });
}

export function renameGroup(session: Session, groupId: string, name: string): Session {
  return patchGroup(session, groupId, {
    name: name.trim().slice(0, MAX_GROUP_NAME),
  });
}

export function recolorGroup(session: Session, groupId: string, color: GroupColor): Session {
  return patchGroup(session, groupId, { color });
}

/**
 * Collapses or expands a group.
 *
 * Collapsing the group the active tab lives in moves activation out first,
 * preferring the tab to the right. If there is nowhere to move to — the group
 * is the entire session — the collapse is refused rather than leaving the
 * window with nothing selected.
 */
export function setGroupCollapsed(session: Session, groupId: string, collapsed: boolean): Session {
  const range = groupRange(session, groupId);
  if (!range) return session;

  let activeTabId = session.activeTabId;
  const active = activeTab(session);

  if (collapsed && active?.groupId === groupId) {
    const escape = session.tabs[range.end + 1] ?? session.tabs[range.start - 1] ?? null;
    if (!escape) return session;
    activeTabId = escape.id;
  }

  return normalize({
    ...patchGroup(session, groupId, { collapsed }),
    activeTabId,
  });
}

function patchGroup(session: Session, groupId: string, patch: Partial<TabGroup>): Session {
  return {
    ...session,
    groups: session.groups.map((group) => (group.id === groupId ? { ...group, ...patch } : group)),
  };
}

/** The least-used colour, so a fourth group does not repeat the first while
 *  unused colours are still available. */
function nextColor(session: Session): GroupColor {
  const used = new Map<GroupColor, number>(GROUP_COLORS.map((color) => [color, 0]));
  for (const group of session.groups) {
    used.set(group.color, (used.get(group.color) ?? 0) + 1);
  }
  return GROUP_COLORS.reduce((best, color) =>
    (used.get(color) ?? 0) < (used.get(best) ?? 0) ? color : best,
  );
}

// --- the repair function ----------------------------------------------------

/**
 * Repairs any invariant violation, and is idempotent — `normalize(normalize(s))`
 * equals `normalize(s)`, which is asserted as a property in the tests.
 *
 * Every mutator ends with a call to this, and so does session hydration, which
 * is the case that actually matters: `config.json` is a file a user can edit.
 */
export function normalize(session: Session): Session {
  // Unique ids and unique paths. First occurrence wins.
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  let tabs: Tab[] = [];
  for (const tab of session.tabs) {
    if (seenIds.has(tab.id) || seenPaths.has(tab.path)) continue;
    seenIds.add(tab.id);
    seenPaths.add(tab.path);
    tabs.push(tab);
  }

  const groupIds = new Set<string>();
  const groups: TabGroup[] = [];
  for (const group of session.groups) {
    if (groupIds.has(group.id)) continue;
    groupIds.add(group.id);
    groups.push({
      ...group,
      name: group.name.trim().slice(0, MAX_GROUP_NAME),
      color: (GROUP_COLORS as readonly string[]).includes(group.color) ? group.color : "slate",
    });
  }

  let seenPreview = false;
  tabs = tabs.map((tab) => {
    const preview = tab.preview && !seenPreview;
    if (preview) seenPreview = true;
    return {
      ...tab,
      preview,
      groupId: tab.groupId && groupIds.has(tab.groupId) ? tab.groupId : null,
      openerId:
        tab.openerId && tab.openerId !== tab.id && seenIds.has(tab.openerId) ? tab.openerId : null,
    };
  });

  tabs = makeContiguous(tabs);

  const populated = new Set(
    tabs.map((tab) => tab.groupId).filter((id): id is string => id !== null),
  );
  let liveGroups = groups.filter((group) => populated.has(group.id));

  let activeTabId = session.activeTabId;
  if (tabs.length === 0) {
    activeTabId = null;
  } else if (!activeTabId || !seenIds.has(activeTabId)) {
    activeTabId = tabs[0]!.id;
  }

  // An active tab inside a collapsed group is invisible, so the group opens.
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (active?.groupId) {
    liveGroups = liveGroups.map((group) =>
      group.id === active.groupId ? { ...group, collapsed: false } : group,
    );
  }

  return { tabs, groups: liveGroups, activeTabId };
}

/**
 * Rewrites the order so every group is one contiguous run, anchoring each group
 * at its *first* member.
 *
 * Anchoring at the first member is what makes the repair deterministic on
 * hostile input: interleaved `A B A B` always becomes `A A B B`, never
 * `B B A A`, so a hand-edited config loads the same way every time.
 */
function makeContiguous(tabs: Tab[]): Tab[] {
  const emitted = new Set<string>();
  const out: Tab[] = [];

  for (const tab of tabs) {
    if (emitted.has(tab.id)) continue;

    if (tab.groupId === null) {
      out.push(tab);
      emitted.add(tab.id);
      continue;
    }

    for (const member of tabs) {
      if (member.groupId === tab.groupId && !emitted.has(member.id)) {
        out.push(member);
        emitted.add(member.id);
      }
    }
  }

  return out;
}

// --- seam arithmetic --------------------------------------------------------

function rangeIn(tabs: Tab[], groupId: string): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  tabs.forEach((tab, index) => {
    if (tab.groupId !== groupId) return;
    if (start < 0) start = index;
    end = index;
  });
  return start < 0 ? null : { start, end };
}

/** The group a seam falls strictly inside, if any. Boundary seams belong to no
 *  group, which is exactly what makes them safe drop targets. */
function groupAtInteriorSeam(tabs: Tab[], seam: Seam): string | null {
  for (const groupId of groupIdsIn(tabs)) {
    const range = rangeIn(tabs, groupId)!;
    if (seam > range.start && seam <= range.end) return groupId;
  }
  return null;
}

/** Pushes a seam out of any group it lands inside, to whichever edge is nearer.
 *  This is what stops an ungrouped tab from punching a hole through a group. */
function snapOutOfGroups(tabs: Tab[], seam: Seam): Seam {
  const groupId = groupAtInteriorSeam(tabs, seam);
  if (groupId === null) return seam;
  const range = rangeIn(tabs, groupId)!;
  return seam - range.start <= range.end + 1 - seam ? range.start : range.end + 1;
}

function groupIdsIn(tabs: Tab[]): string[] {
  const ids: string[] = [];
  for (const tab of tabs) {
    if (tab.groupId !== null && !ids.includes(tab.groupId)) ids.push(tab.groupId);
  }
  return ids;
}

function insertAt(tabs: Tab[], seam: Seam, tab: Tab): Tab[] {
  return [...tabs.slice(0, seam), tab, ...tabs.slice(seam)];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
