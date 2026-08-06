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

/**
 * A settings change, as fields to merge or as a function of the current values.
 *
 * The function form is not a convenience: a control that steps a value — zoom —
 * would otherwise compute every step from the values of the render it was drawn
 * in, so three fast clicks all produce the same single step.
 */
export type ConfigPatch = Partial<AppConfig> | ((current: AppConfig) => Partial<AppConfig>);

interface ConfigContextValue {
  config: AppConfig;
  loaded: boolean;
  error: string | null;
  update: (patch: ConfigPatch) => void;
  reload: () => void;
}

/** Used until the real config arrives, and if loading fails. Kept in step with
 *  `AppConfig::default()` in `src-tauri/src/config.rs`. */
// Exported for the contract test, which compares its field set against the JSON Rust
// actually produces. Three copies of one shape (this, `AppConfigSchema`, and `AppConfig`
// in `config.rs`) is the arrangement AGENTS.md warns about; the test is what makes the
// drift loud instead of a runtime surprise.
export const FALLBACK: AppConfig = {
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
  showHiddenFiles: false,
  reopenLastDocument: true,
  zoom: 1,
  smartPunctuation: false,
  session: EMPTY_SESSION,
};

const WRITE_DEBOUNCE_MS = 250;

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setLocal] = useState<AppConfig>(FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  /**
   * Whether `config` reflects what is actually on disk.
   *
   * A ref rather than state because the debounced write reads it from inside a
   * timeout, where the `error` of the render that scheduled it would be stale.
   */
  const inSyncWithDisk = useRef(true);

  const reload = useCallback(() => {
    getConfig()
      .then((next) => {
        setLocal(next);
        setError(null);
        inSyncWithDisk.current = true;
      })
      .catch((e: unknown) => {
        // A corrupt config file must not leave a blank window: fall back to the
        // defaults and say so, rather than failing to start.
        setError(e instanceof Error ? e.message : String(e));
        // But `config` is now FALLBACK, which is *not* what is on disk. Writing it
        // back would replace the file with defaults — and `useTabs` calls `update`
        // on ordinary tab activity, so opening one document was enough to do it
        // inside the debounce window. The reader loses every custom theme, their
        // recents and their session, having seen nothing go wrong.
        inSyncWithDisk.current = false;
      })
      .finally(() => {
        setLoaded(true);
      });
  }, []);

  useEffect(reload, [reload]);

  const update = useCallback((patch: ConfigPatch) => {
    setLocal((current) => {
      const next = {
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      };

      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        // Refuse to write over a file we could not read. The in-memory state is the
        // fallback, not the reader's settings, and persisting it destroys the file
        // this session failed to parse — which is also the copy someone would need
        // to repair it by hand.
        if (!inSyncWithDisk.current) return;
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
