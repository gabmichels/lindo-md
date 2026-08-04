import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
} from "lucide-react";

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
}: ToolbarProps) {
  return (
    <div className="flex h-[var(--ui-toolbar-h)] shrink-0 items-center gap-1 px-2">
      <NavButton
        label="Back"
        icon={ChevronLeft}
        disabled={!canGoBack}
        onClick={onBack}
      />
      <NavButton
        label="Forward"
        icon={ChevronRight}
        disabled={!canGoForward}
        onClick={onForward}
      />

      <Breadcrumb breadcrumb={breadcrumb} path={path} />

      <NavButton label="Find in document" icon={Search} onClick={onFind} />
      <NavButton
        label="Appearance"
        icon={SlidersHorizontal}
        onClick={onAppearance}
      />
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
  onClick,
}: {
  label: string;
  icon: typeof ChevronLeft;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-ui-sm",
        "text-ui-text-muted transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-1 hover:text-ui-text-strong",
        "disabled:pointer-events-none disabled:opacity-30",
      )}
    >
      <Icon size={15} strokeWidth={1.5} aria-hidden />
    </button>
  );
}
