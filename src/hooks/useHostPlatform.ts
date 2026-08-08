import { useEffect, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";

export type HostPlatform = "windows" | "macos" | "linux";

/**
 * Which OS we are drawing window controls for.
 *
 * The window is frameless, so this is not cosmetic: macOS keeps its real traffic
 * lights (the rail insets to clear them), while Windows and Linux need controls
 * drawn by us, in each platform's own order and semantics. `TitleBar` draws all
 * of that and is the only place per-platform *chrome* branching lives.
 *
 * `App` is the one other consumer, and only to spell a modifier key: the command
 * palette prints `⌘` beside a row on macOS and `Ctrl` elsewhere. Reach for it
 * for naming, not for laying anything out.
 */
export function useHostPlatform(): HostPlatform {
  const [host, setHost] = useState<HostPlatform>(guessFromUserAgent);

  useEffect(() => {
    try {
      const current = platform();
      if (current === "macos" || current === "windows" || current === "linux") {
        setHost(current);
      }
    } catch {
      // Outside a Tauri host — the specimen route in a browser — the user-agent
      // guess is good enough to lay the chrome out.
    }
  }, []);

  return host;
}

function guessFromUserAgent(): HostPlatform {
  if (typeof navigator === "undefined") return "windows";
  const agent = navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(agent)) return "macos";
  if (/Linux|X11/.test(agent)) return "linux";
  return "windows";
}
