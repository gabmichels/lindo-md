import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  IDLE,
  commitOf,
  displacementOf,
  isDragging,
  reduce,
  type DragEvent,
  type DragSnapshot,
  type DragState,
  type DragSubject,
} from "@/lib/tabs/drag";
import {
  DRAG_RESERVE,
  GROUP_PAD,
  OVERFLOW_W,
  PLUS_W,
  clampPill,
  layoutTabs,
  pillWidthFor,
  type Slot,
} from "@/lib/tabs/layout";
import type { MoveIntent, Session, Tab, TabGroup } from "@/lib/tabs/model";
import {
  ContextItem,
  ContextSeparator,
  ITEM_CLASS,
  MENU_CLASS,
} from "@/components/ui/menu";
import { basename, cn } from "@/lib/utils";

/**
 * The tab strip, living in the titlebar band.
 *
 * Deliberately free of every Tauri call so it can be mounted in the design
 * specimen, which runs in a plain browser — the window controls beside it
 * cannot, which is why they stay in `TitleBar`.
 *
 * Three things about the frameless window shape this component:
 *
 * - The track is `no-drag` as a whole, not just the tabs. The gaps between
 *   tabs would otherwise be live window-drag slivers, and a click landing in
 *   one would start moving the window instead of selecting a tab.
 * - A reserved run of `drag-region` is kept at the end whatever happens, so
 *   the window can always be moved and double-click-maximized.
 * - A dragged tab is never reparented into an overlay to raise it. Chromium
 *   fires `lostpointercapture` when a captured element leaves the document,
 *   which would kill the gesture; it is raised with `z-index` instead.
 *
 * The gesture itself lives in `lib/tabs/drag.ts` as a pure reducer. This file
 * only measures, feeds it events, and draws what it returns.
 */

export interface TabStripProps {
  session: Session;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onToggleGroup: (groupId: string) => void;
  onReorder?: (id: string, seam: number, intent: MoveIntent) => void;
  onReorderGroup?: (groupId: string, seam: number) => void;
  onCloseOthers?: (id: string) => void;
  onCloseToRight?: (id: string) => void;
  onRemoveFromGroup?: (id: string) => void;
  onNewGroup?: (id: string) => void;
  onAddToGroup?: (id: string, groupId: string) => void;
  onRenameGroup?: (groupId: string) => void;
  onUngroup?: (groupId: string) => void;
  onCloseGroup?: (groupId: string) => void;
  onRevealInFolder?: (id: string) => void;
  /** Full path for the tooltip; the label itself is just the file name. */
  pathFor?: (tab: Tab) => string;
}

/** Not exported: a module that exports both components and plain functions
 *  cannot Fast Refresh, and the whole file reloads on every edit instead. */
function labelFor(tab: Tab): string {
  return basename(tab.path).replace(/\.(md|markdown|mdown|mkd)$/i, "");
}

export function TabStrip({
  session,
  onActivate,
  onClose,
  onNewTab,
  onToggleGroup,
  onReorder,
  onReorderGroup,
  onCloseOthers,
  onCloseToRight,
  onRemoveFromGroup,
  onNewGroup,
  onAddToGroup,
  onRenameGroup,
  onUngroup,
  onCloseGroup,
  onRevealInFolder,
  pathFor,
}: TabStripProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry!.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pillWidths = usePillWidths(session.groups);
  const { slots, overflow, trackWidth } = layoutTabs({
    session,
    stripWidth: width + PLUS_W + DRAG_RESERVE,
    pillWidths,
  });

  const activeId = session.activeTabId;

  const [drag, setDrag] = useState<DragState>(IDLE);
  // Also held in a ref: a pointermove has to reduce against the newest state
  // and commit synchronously on release, neither of which can wait for React.
  const currentDrag = useRef(drag);
  const dispatch = useCallback((event: DragEvent) => {
    const next = reduce(currentDrag.current, event);
    if (next === currentDrag.current) return;
    currentDrag.current = next;
    setDrag(next);
  }, []);

  /** Set when a press turned into a drag, so the click that follows the release
   *  does not also activate the tab. */
  const dragged = useRef(false);

  const bands = useMemo(() => {
    return session.groups.flatMap((group) => {
      const members = slots.filter((slot) => slot.groupId === group.id);
      if (members.length === 0) return [];
      const left = Math.min(...members.map((slot) => slot.left)) - GROUP_PAD;
      const right =
        Math.max(...members.map((slot) => slot.left + slot.width)) + GROUP_PAD;
      return [{ id: group.id, color: group.color, left, width: right - left }];
    });
  }, [slots, session.groups]);

  const snapshotFor = useCallback(
    (subject: DragSubject, pointerX: number): DragSnapshot | null => {
      const slotIndex = slots.findIndex((slot) =>
        subject.kind === "group"
          ? slot.kind === "pill" && slot.key === subject.id
          : slot.kind === "tab" && slot.key === subject.id,
      );
      if (slotIndex < 0) return null;

      // A group travels as one block: its pill plus whichever of its members
      // are drawn, which is none at all when it is collapsed.
      const blockLength =
        subject.kind === "group"
          ? 1 + slots.filter((slot) => slot.kind === "tab" && slot.groupId === subject.id).length
          : 1;

      return {
        slots,
        order: session.tabs.map((tab) => tab.id),
        groupOf: Object.fromEntries(session.tabs.map((tab) => [tab.id, tab.groupId])),
        subject,
        slotIndex,
        blockLength,
        grabOffset: pointerX - slots[slotIndex]!.left,
        trackWidth,
      };
    },
    [slots, session.tabs, trackWidth],
  );

  const trackPoint = useCallback((clientX: number, clientY: number) => {
    const box = track.current?.getBoundingClientRect();
    return box
      ? { x: clientX - box.left, y: clientY - box.top }
      : { x: clientX, y: clientY };
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent, subject: DragSubject) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const { x, y } = trackPoint(event.clientX, event.clientY);
      const snapshot = snapshotFor(subject, x);
      if (!snapshot) return;

      dragged.current = false;
      // Captured immediately, and `preventDefault` with it: without both, the
      // titlebar's own drag region can take the pointer and move the window.
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      dispatch({ type: "down", pointerId: event.pointerId, x, y, snapshot });
    },
    [dispatch, snapshotFor, trackPoint],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (currentDrag.current.kind === "idle") return;
      const { x, y } = trackPoint(event.clientX, event.clientY);
      dispatch({ type: "move", pointerId: event.pointerId, x, y, now: event.timeStamp });
      if (isDragging(currentDrag.current)) dragged.current = true;
    },
    [dispatch, trackPoint],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      const state = currentDrag.current;
      const target = commitOf(state);
      const subject = state.kind === "idle" ? null : state.snapshot.subject;
      dispatch({ type: "up", pointerId: event.pointerId });

      if (!target || !subject) return;
      // Committed here and now, before any animation: under reduced motion
      // there is no transition to wait for, so nothing may depend on one.
      if (subject.kind === "group") onReorderGroup?.(subject.id, target.seam);
      else onReorder?.(subject.id, target.seam, target.intent);
    },
    [dispatch, onReorder, onReorderGroup],
  );

  const cancel = useCallback(() => dispatch({ type: "cancel" }), [dispatch]);

  // A drag in progress owns Escape outright — bound in the capture phase so the
  // find bar and any open dialog cannot swallow it first.
  useEffect(() => {
    if (!isDragging(drag)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", cancel);
    };
  }, [drag, cancel]);

  // A tab closing mid-drag — a live reload, another window — aborts the gesture
  // rather than letting it commit against a session that no longer matches.
  const known = useRef<string[]>([]);
  useEffect(() => {
    const ids = session.tabs.map((tab) => tab.id);
    const removed = known.current.filter((id) => !ids.includes(id));
    known.current = ids;
    if (removed.length > 0) dispatch({ type: "invalidate", removedIds: removed });
  }, [session.tabs, dispatch]);

  // Keep the active tab reachable when the strip has scrolled.
  useEffect(() => {
    if (!overflow || !activeId) return;
    viewport.current
      ?.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, overflow]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const drawn = slots.filter((slot) => slot.kind === "tab");
      const index = drawn.findIndex((slot) => slot.key === activeId);
      if (index < 0) return;

      const delta =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = drawn[(index + delta + drawn.length) % drawn.length];
      if (next) onActivate(next.key);
    },
    [slots, activeId, onActivate],
  );

  const activate = useCallback(
    (id: string) => {
      if (dragged.current) return;
      onActivate(id);
    },
    [onActivate],
  );

  const subjectId = drag.kind === "idle" ? null : drag.snapshot.subject.id;

  const gestures = {
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };

  return (
    // Inset on the left to sit on the same margin as the toolbar's controls
    // below it, so the two rows of chrome share one edge instead of the tabs
    // running into the seam against the rail. Applied here rather than on the
    // measured viewport, whose width is the drag layer's coordinate space.
    <div className="flex h-full min-w-0 flex-1 items-stretch pl-2">
      <div
        ref={viewport}
        className="tab-track no-drag relative min-w-0 flex-1 overflow-x-auto"
        role="tablist"
        aria-label="Open documents"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
      >
        <div
          ref={track}
          className="relative h-full isolate"
          style={{ width: trackWidth, touchAction: "none" }}
          // Width transitions are off for the duration: the tab has to track
          // the pointer exactly, and a width animating at the same time as a
          // transform is the one combination that visibly fights itself.
          data-dragging={isDragging(drag) ? "" : undefined}
        >
          {/* A tinted band behind each group's run, drawn before the tabs so it
              sits under them. This — not a mark on every member — is what makes
              a group read as one object: the tabs keep their own plane, and the
              colour belongs to the container around them. */}
          {bands.map((band) => (
            <span
              key={`band-${band.id}`}
              aria-hidden
              className="absolute inset-y-1 rounded-ui-md"
              style={{
                left: band.left,
                width: band.width,
                background: `color-mix(in oklab, var(--ui-group-${band.color}) 22%, transparent)`,
              }}
            />
          ))}

          {slots.map((slot, index) => {
            const offset = displacementOf(drag, index);

            if (slot.kind === "pill") {
              const group = session.groups.find((candidate) => candidate.id === slot.key);
              if (!group) return null;
              return (
                <ContextMenu.Root key={`pill-${slot.key}`}>
                  <ContextMenu.Trigger asChild>
                    <GroupPill
                      group={group}
                      count={
                        session.tabs.filter((tab) => tab.groupId === group.id).length
                      }
                      slot={slot}
                      offset={offset}
                      dragging={subjectId === group.id && isDragging(drag)}
                      onToggle={() => {
                        if (dragged.current) return;
                        onToggleGroup(group.id);
                      }}
                      onPointerDown={(event) =>
                        onPointerDown(event, { kind: "group", id: group.id })
                      }
                      {...gestures}
                    />
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className={MENU_CLASS}>
                      <ContextItem onSelect={() => onRenameGroup?.(group.id)}>
                        Rename and recolour…
                      </ContextItem>
                      <ContextItem
                        onSelect={() => onToggleGroup(group.id)}
                      >
                        {group.collapsed ? "Expand" : "Collapse"}
                      </ContextItem>
                      <ContextSeparator />
                      <ContextItem onSelect={() => onUngroup?.(group.id)}>
                        Ungroup
                      </ContextItem>
                      <ContextItem onSelect={() => onCloseGroup?.(group.id)}>
                        Close group
                      </ContextItem>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              );
            }

            const tab = session.tabs.find((candidate) => candidate.id === slot.key);
            if (!tab) return null;

            return (
              <ContextMenu.Root key={tab.id}>
                <ContextMenu.Trigger asChild>
                  <TabButton
                    tab={tab}
                    active={tab.id === activeId}
                    slot={slot}
                    offset={offset}
                    dragging={subjectId === tab.id && isDragging(drag)}
                    title={pathFor?.(tab) ?? tab.path}
                    onActivate={() => activate(tab.id)}
                    onClose={() => onClose(tab.id)}
                    onPointerDown={(event) =>
                      onPointerDown(event, { kind: "tab", id: tab.id })
                    }
                    {...gestures}
                  />
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className={MENU_CLASS}>
                    <ContextItem onSelect={() => onClose(tab.id)}>Close</ContextItem>
                    <ContextItem
                      onSelect={() => onCloseOthers?.(tab.id)}
                      disabled={session.tabs.length < 2}
                    >
                      Close others
                    </ContextItem>
                    <ContextItem
                      onSelect={() => onCloseToRight?.(tab.id)}
                      disabled={
                        session.tabs.findIndex((candidate) => candidate.id === tab.id) ===
                        session.tabs.length - 1
                      }
                    >
                      Close to the right
                    </ContextItem>

                    <ContextSeparator />

                    {/* Every drag gesture has a menu equivalent, so the pointer
                        path is an accelerator rather than the only way in. */}
                    {tab.groupId === null ? (
                      <>
                        <ContextItem onSelect={() => onNewGroup?.(tab.id)}>
                          Add to new group…
                        </ContextItem>
                        {session.groups.map((group) => (
                          <ContextItem
                            key={group.id}
                            onSelect={() => onAddToGroup?.(tab.id, group.id)}
                          >
                            <span
                              aria-hidden
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: `var(--ui-group-${group.color})` }}
                            />
                            Add to {group.name || "unnamed group"}
                          </ContextItem>
                        ))}
                      </>
                    ) : (
                      <ContextItem onSelect={() => onRemoveFromGroup?.(tab.id)}>
                        Remove from group
                      </ContextItem>
                    )}

                    <ContextSeparator />

                    <ContextItem onSelect={() => onRevealInFolder?.(tab.id)}>
                      Show in the file manager
                    </ContextItem>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            );
          })}
        </div>
      </div>

      <div className="no-drag flex items-center">
        {/* The only way to reach a tab that has scrolled out of sight, so it
            lists every one — grouped, and with the active one marked. */}
        {overflow && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <StripButton label="All open documents" icon={ChevronDown} width={OVERFLOW_W} />
            </DropdownMenu.Trigger>
            <MenuContent>
              {session.tabs.map((tab) => {
                const group = tab.groupId
                  ? session.groups.find((candidate) => candidate.id === tab.groupId)
                  : undefined;
                return (
                  <MenuItem key={tab.id} onSelect={() => onActivate(tab.id)}>
                    <span className="grid size-3.5 shrink-0 place-items-center">
                      {tab.id === activeId && <Check size={12} strokeWidth={2} aria-hidden />}
                    </span>
                    {group && (
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: `var(--ui-group-${group.color})` }}
                      />
                    )}
                    <span className="min-w-0 truncate">{labelFor(tab)}</span>
                  </MenuItem>
                );
              })}
            </MenuContent>
          </DropdownMenu.Root>
        )}
        <StripButton
          label="Open a file in a new tab"
          icon={Plus}
          width={PLUS_W}
          onClick={onNewTab}
        />
      </div>

      {/* Always draggable, however many tabs are open — on a frameless window
          this is the only way left to move or maximize it. */}
      <div className="drag-region shrink-0" style={{ width: DRAG_RESERVE }} aria-hidden />
    </div>
  );
}

interface Gestures {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
}

function placement(slot: Slot, offset: number, dragging: boolean) {
  return {
    left: slot.left,
    width: slot.width,
    transform: offset === 0 ? undefined : `translate3d(${offset}px,0,0)`,
    // The subject follows the pointer one to one; everything else glides.
    transition: dragging ? "none" : undefined,
    zIndex: dragging ? 2 : undefined,
  };
}

function TabButton({
  tab,
  active,
  slot,
  offset,
  dragging,
  title,
  onActivate,
  onClose,
  ...gestures
}: Gestures & {
  tab: Tab;
  active: boolean;
  slot: Slot;
  offset: number;
  dragging: boolean;
  title: string;
  onActivate: () => void;
  onClose: () => void;
}) {
  const label = labelFor(tab);

  return (
    <div
      data-tab-id={tab.id}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={title}
      draggable={false}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
      // Middle-click closes, the way it does in a browser.
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        onClose();
      }}
      {...gestures}
      className={cn(
        "group tab-slot absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5",
        "cursor-default rounded-ui-md px-2.5 text-[12.5px] select-none",
        // Every tab gets a body. Depth comes from the plane it sits on, not
        // from an outline: the active one is raised to plane 2, the rest rest
        // on plane 1, and only the active one reads as the sheet on top.
        active
          ? "bg-ui-plane-2 text-ui-text-strong"
          : "bg-ui-plane-1 text-ui-text-muted hover:text-ui-text-strong",
        dragging && "shadow-lg",
      )}
      style={{ ...placement(slot, offset, dragging), height: 28 }}
    >
      <span className={cn("min-w-0 flex-1 truncate", tab.preview && "italic")}>
        {label}
      </span>

      <button
        type="button"
        aria-label={`Close ${label}`}
        title={`Close ${label}`}
        draggable={false}
        // Stops the press from arming a drag, so the close button stays a
        // button rather than a very small handle.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-ui-sm",
          "text-ui-text-faint opacity-0 transition-[opacity,background-color,color]",
          "duration-[var(--ui-dur)] group-hover:opacity-100",
          "hover:bg-ui-plane-2 hover:text-ui-text-strong focus-visible:opacity-100",
          active && "opacity-100",
        )}
      >
        <X size={11} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

function GroupPill({
  group,
  count,
  slot,
  offset,
  dragging,
  onToggle,
  ...gestures
}: Gestures & {
  group: TabGroup;
  count: number;
  slot: Slot;
  offset: number;
  dragging: boolean;
  onToggle: () => void;
}) {
  const label = group.name || "Unnamed group";

  return (
    <button
      type="button"
      aria-label={
        group.collapsed ? `Expand ${label}, ${count} documents` : `Collapse ${label}`
      }
      aria-expanded={!group.collapsed}
      title={label}
      draggable={false}
      onClick={onToggle}
      {...gestures}
      className={cn(
        "tab-slot absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5",
        "rounded-ui-md px-2 text-[11.5px] font-medium text-ui-text-strong",
        "hover:brightness-110",
        dragging && "shadow-lg",
      )}
      style={{
        ...placement(slot, offset, dragging),
        height: 22,
        background: `color-mix(in oklab, var(--ui-group-${group.color}) 30%, var(--ui-base))`,
      }}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: `var(--ui-group-${group.color})` }}
      />
      {group.name && <span className="min-w-0 truncate">{group.name}</span>}
      {group.collapsed && count > 0 && (
        <span className="shrink-0 tabular-nums text-ui-text-muted">{count}</span>
      )}
    </button>
  );
}

function StripButton({
  label,
  icon: Icon,
  width,
  ...rest
}: React.ComponentPropsWithoutRef<"button"> & {
  label: string;
  icon: typeof Plus;
  width: number;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      style={{ width }}
      className={cn(
        "grid h-7 shrink-0 place-items-center rounded-ui-sm",
        "text-ui-text-muted transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-1 hover:text-ui-text-strong",
      )}
    >
      <Icon size={15} strokeWidth={1.5} aria-hidden />
    </button>
  );
}

function MenuContent({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="end" sideOffset={6} className={MENU_CLASS}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

function MenuItem({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item className={ITEM_CLASS} onSelect={onSelect}>
      {children}
    </DropdownMenu.Item>
  );
}

/**
 * Measures each group's pill against the font actually in use, so a long name
 * reserves the width it really needs. Measured on a canvas rather than by
 * laying out a hidden element, which would force a reflow per group per render.
 */
function usePillWidths(groups: TabGroup[]): Record<string, number> {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const key = groups
    .map((group) => `${group.id}:${group.name}:${group.collapsed}`)
    .join("|");

  useLayoutEffect(() => {
    const measure = () => {
      const context = measuringContext();
      if (!context) return;
      context.font = `500 11.5px ${getComputedStyle(document.body).fontFamily}`;
      setWidths(
        Object.fromEntries(
          groups.map((group) => [
            group.id,
            clampPill(pillWidthFor(group, context.measureText(group.name).width)),
          ]),
        ),
      );
    };

    measure();
    // Measured again once the webfont has arrived: the first pass runs against
    // the fallback face, whose metrics are narrower, and a pill sized from it
    // truncates its own group's name.
    let stale = false;
    void document.fonts?.ready.then(() => {
      if (!stale) measure();
    });
    return () => {
      stale = true;
    };
    // `key` covers exactly the inputs that change a measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return widths;
}

let canvas: HTMLCanvasElement | null = null;

function measuringContext(): CanvasRenderingContext2D | null {
  canvas ??= document.createElement("canvas");
  return canvas.getContext("2d");
}
