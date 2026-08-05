import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useHostPlatform } from "@/hooks/useHostPlatform";
import { cn, dragRegion } from "@/lib/utils";

/**
 * The frameless window's own titlebar, which is also where the tabs live.
 *
 * Every per-platform difference in the window chrome lives here and nowhere
 * else: macOS keeps its real traffic lights (the chrome insets to clear them),
 * while Windows and Linux get controls we draw, in each platform's own order —
 * close last on Windows, close first on Linux's GNOME convention.
 *
 * The tab strip is passed in rather than rendered here, because this component
 * calls `getCurrentWindow()` and so cannot run in the design specimen, while
 * the strip must.
 */

/**
 * How much room the macOS traffic lights need, measured from the window's left
 * edge.
 *
 * Paired with `trafficLightPosition` in `tauri.macos.conf.json` and has to move
 * whenever that does. Measured from the running app rather than derived, because
 * AppKit picks the button size and spacing itself and only the origin is ours:
 * at `x: 15` the buttons land at 14, 37 and 60, each 16pt wide, so the last one
 * ends at 76. The remainder is breathing room before the first tab.
 */
const TRAFFIC_LIGHTS_W = "80px";

export function TitleBar({
  children,
  railCollapsed,
}: {
  children: ReactNode;
  /** The rail already clears the traffic lights when it is open — at 264px it is
   *  far wider than they are. Collapsed it is only 52px, so the shortfall has to
   *  come out of the titlebar or the lights land on the first tab. */
  railCollapsed: boolean;
}) {
  const host = useHostPlatform();
  const railWidth = railCollapsed ? "var(--ui-rail-collapsed-w)" : "var(--ui-rail-w)";

  return (
    <header {...dragRegion("flex h-[var(--ui-titlebar-h)] shrink-0 items-stretch")}>
      {host === "macos" && (
        <div
          {...dragRegion("shrink-0")}
          style={{ width: `max(0px, calc(${TRAFFIC_LIGHTS_W} - ${railWidth}))` }}
          aria-hidden
        />
      )}
      {children}
      {host !== "macos" && <WindowControls host={host} />}
    </header>
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
      void unlisten.then((off) => {
        off();
      });
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
            host === "windows" ? "h-full w-[46px]" : "my-1 mr-1 size-7 rounded-full",
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
