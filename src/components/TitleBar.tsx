import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Search,
  Square,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useHostPlatform } from "@/hooks/useHostPlatform";
import { cn } from "@/lib/utils";

/**
 * The frameless window's own titlebar.
 *
 * Every per-platform difference in the window chrome lives here and nowhere
 * else: macOS keeps its real traffic lights (the rail insets to clear them),
 * while Windows and Linux get controls we draw, in each platform's own order —
 * close last on Windows, close first on Linux's GNOME convention.
 */

interface TitleBarProps {
  breadcrumb: { folder: string | null; name: string } | null;
  path: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onFind: () => void;
  onSettings: () => void;
}

export function TitleBar({
  breadcrumb,
  path,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onFind,
  onSettings,
}: TitleBarProps) {
  const host = useHostPlatform();

  return (
    <header
      className="drag-region flex h-[var(--ui-titlebar-h)] shrink-0 items-center gap-1 pr-0 pl-2"
      // The whole bar drags the window; interactive children opt out with
      // `no-drag`, or they would move the window instead of being clickable.
    >
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
        label="Appearance settings"
        icon={SlidersHorizontal}
        onClick={onSettings}
      />

      {host !== "macos" && <WindowControls host={host} />}
    </header>
  );
}

function Breadcrumb({
  breadcrumb,
  path,
}: {
  breadcrumb: TitleBarProps["breadcrumb"];
  path: string | null;
}) {
  if (!breadcrumb) {
    return <div className="flex-1 text-center text-ui-text-faint">pretty-md</div>;
  }

  return (
    <button
      type="button"
      className={cn(
        "no-drag mx-2 flex min-w-0 flex-1 items-center justify-center gap-1.5",
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
        "no-drag grid size-7 place-items-center rounded-ui-sm",
        "text-ui-text-muted transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-1 hover:text-ui-text-strong",
        "disabled:pointer-events-none disabled:opacity-30",
      )}
    >
      <Icon size={15} strokeWidth={1.5} aria-hidden />
    </button>
  );
}

/**
 * Caption buttons for Windows and Linux.
 *
 * Sized to each platform's convention rather than to a shared design: 46×32 with
 * a red close on Windows, and compact round buttons in GNOME's close-first order
 * on Linux. Matching the OS matters more here than matching ourselves — these
 * are the one part of the window a user operates by muscle memory.
 */
function WindowControls({ host }: { host: "windows" | "linux" }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const window = getCurrentWindow();
    const sync = () => {
      void window.isMaximized().then(setMaximized, () => undefined);
    };
    sync();
    const unlisten = window.onResized(sync);
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  const buttons = [
    {
      key: "minimize",
      label: "Minimize",
      icon: Minus,
      danger: false,
      action: () => void getCurrentWindow().minimize(),
    },
    {
      key: "maximize",
      label: maximized ? "Restore" : "Maximize",
      icon: Square,
      danger: false,
      action: () => void getCurrentWindow().toggleMaximize(),
    },
    {
      key: "close",
      label: "Close",
      icon: X,
      danger: true,
      action: () => void getCurrentWindow().close(),
    },
  ];

  const ordered = host === "linux" ? [...buttons].reverse() : buttons;

  return (
    <div className="no-drag ml-1 flex h-full items-stretch">
      {ordered.map(({ key, label, icon: Icon, danger, action }) => (
        <button
          key={key}
          type="button"
          aria-label={label}
          title={label}
          onClick={action}
          className={cn(
            "grid place-items-center text-ui-text-muted",
            "transition-colors duration-[var(--ui-dur)]",
            host === "windows"
              ? "h-full w-[46px]"
              : "my-1 mr-1 size-7 rounded-full",
            danger
              ? "hover:bg-ui-danger hover:text-white"
              : "hover:bg-ui-plane-2 hover:text-ui-text-strong",
          )}
        >
          <Icon size={key === "maximize" ? 11 : 14} strokeWidth={1.6} aria-hidden />
        </button>
      ))}
    </div>
  );
}
