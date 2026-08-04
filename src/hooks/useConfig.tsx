import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getConfig, setConfig, type AppConfig } from "@/lib/ipc";
import { EMPTY_SESSION } from "@/lib/tabs/model";

/**
 * Loads settings once at startup and holds them for the session.
 *
 * `update` merges a patch and persists it. Writes are debounced because the
 * settings drawer is full of sliders: dragging one would otherwise write the
 * config file on every animation frame.
 */

interface ConfigContextValue {
  config: AppConfig;
  loaded: boolean;
  error: string | null;
  update: (patch: Partial<AppConfig>) => void;
  reload: () => void;
}

/** Used until the real config arrives, and if loading fails. Kept in step with
 *  `AppConfig::default()` in `src-tauri/src/config.rs`. */
const FALLBACK: AppConfig = {
  version: 1,
  themeId: "house",
  appearance: "system",
  customThemes: [],
  railWidth: 264,
  railCollapsed: false,
  recentFiles: [],
  lastFolder: null,
  blockRemoteImages: true,
  respectGitignore: true,
  session: EMPTY_SESSION,
};

const WRITE_DEBOUNCE_MS = 250;

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setLocal] = useState<AppConfig>(FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const reload = useCallback(() => {
    getConfig()
      .then((next) => {
        setLocal(next);
        setError(null);
      })
      .catch((e: unknown) => {
        // A corrupt config file must not leave a blank window: fall back to the
        // defaults and say so, rather than failing to start.
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(reload, [reload]);

  const update = useCallback((patch: Partial<AppConfig>) => {
    setLocal((current) => {
      const next = { ...current, ...patch };

      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        // A failed write is not worth interrupting reading for; the in-memory
        // state is already correct and the next write will retry.
        void setConfig(next).catch(() => undefined);
      }, WRITE_DEBOUNCE_MS);

      return next;
    });
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ConfigContext.Provider value={{ config, loaded, error, update, reload }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error("useConfig must be used inside a ConfigProvider");
  return value;
}
