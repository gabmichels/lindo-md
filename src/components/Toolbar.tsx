import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  Columns2,
  Highlighter,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { ReadOnlyBadge } from "@/components/ReadOnlyBadge";
import { cn } from "@/lib/utils";

/**
 * The row under the tabs: where you are, and how to move around inside the
 * active document.
 *
 * This was the titlebar in the single-document days. Tabs took that row over,
 * and these controls came down here — which also puts back/forward next to the
 * document they act on rather than next to the window controls, since with tabs
 * the history they walk is the active tab's own.
 */

interface ToolbarProps {
  breadcrumb: { folder: string | null; name: string } | null;
  path: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onFind: () => void;
  onAppearance: () => void;
  /** True when the reader is looking at the Markdown rather than the page. */
  sourceMode: boolean;
  onToggleSource: () => void;
  /**
   * Why this document cannot be edited, or null when it can be.
   *
   * A string rather than a bool because "read-only" on its own invites the reader to
   * hunt for the switch that turns it off. There isn't one — it is a property of the
   * file — so the badge says which property.
   */
  readOnlyReason: string | null;
  /** True while the comparison pane is showing a second document. */
  compareOpen: boolean;
  onToggleCompare: () => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
}

export function Toolbar({
  breadcrumb,
  path,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onFind,
  onAppearance,
  sourceMode,
  onToggleSource,
  readOnlyReason,
  compareOpen,
  onToggleCompare,
  notesOpen,
  onToggleNotes,
}: ToolbarProps) {
  return (
    <div className="flex h-[var(--ui-toolbar-h)] shrink-0 items-center gap-1 px-2">
      <NavButton label="Back" icon={ChevronLeft} disabled={!canGoBack} onClick={onBack} />
      <NavButton label="Forward" icon={ChevronRight} disabled={!canGoForward} onClick={onForward} />

      <Breadcrumb breadcrumb={breadcrumb} path={path} />

      {readOnlyReason && <ReadOnlyBadge reason={readOnlyReason} />}

      {/* Hidden rather than disabled for a read-only document: the source view is an
          editable textarea that saves on blur, so there is no version of it that makes
          sense here. A greyed-out control implies a state that could be reached. */}
      {!readOnlyReason && (
        <NavButton
          label={sourceMode ? "Show the rendered document" : "Edit as Markdown"}
          icon={sourceMode ? BookOpen : Code2}
          active={sourceMode}
          onClick={onToggleSource}
        />
      )}
      <NavButton
        // Named for what it opens rather than for the geometry: "Split" says
        // how the window ends up, "Compare" says why anyone would want it.
        label={compareOpen ? "Close the comparison pane" : "Compare with another file…"}
        icon={Columns2}
        active={compareOpen}
        onClick={onToggleCompare}
      />
      <NavButton
        // Not gated on the document being annotatable. The panel spans every
        // folder, so it has something to show while a plain-text file — which
        // cannot be marked at all — is the one on screen.
        label={notesOpen ? "Hide notes" : "Show notes"}
        icon={Highlighter}
        active={notesOpen}
        onClick={onToggleNotes}
      />
      <NavButton label="Find in document" icon={Search} onClick={onFind} />
      <NavButton label="Appearance" icon={SlidersHorizontal} onClick={onAppearance} />
    </div>
  );
}

function Breadcrumb({
  breadcrumb,
  path,
}: {
  breadcrumb: ToolbarProps["breadcrumb"];
  path: string | null;
}) {
  if (!breadcrumb) {
    return <div className="flex-1" />;
  }

  return (
    <button
      type="button"
      className={cn(
        "mx-2 flex min-w-0 flex-1 items-center justify-center gap-1.5",
        "rounded-ui-md px-2 py-1 text-[12.5px] transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-1",
      )}
      title={path ? `Show ${path} in the file manager` : undefined}
      onClick={() => {
        if (path) void revealItemInDir(path).catch(() => undefined);
      }}
    >
      {breadcrumb.folder && (
        <>
          <span className="truncate text-ui-text-faint">{breadcrumb.folder}</span>
          <span className="text-ui-text-faint">/</span>
        </>
      )}
      <span className="truncate text-ui-text">{breadcrumb.name}</span>
    </button>
  );
}

function NavButton({
  label,
  icon: Icon,
  disabled,
  active,
  onClick,
}: {
  label: string;
  icon: typeof ChevronLeft;
  disabled?: boolean;
  /** Held down, for a control that reflects a state rather than firing once. */
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-ui-sm",
        "text-ui-text-muted transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-1 hover:text-ui-text-strong",
        "disabled:pointer-events-none disabled:opacity-30",
        // Ember marks the active surface, the same as it does in the rail.
        active && "bg-ui-ember-wash text-ui-text-strong",
      )}
    >
      <Icon size={15} strokeWidth={1.5} aria-hidden />
    </button>
  );
}
