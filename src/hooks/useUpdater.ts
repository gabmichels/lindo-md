import { useCallback, useEffect, useRef, useState } from "react";

import { useHostPlatform } from "@/hooks/useHostPlatform";
import {
  NOT_STARTED,
  checkForUpdate,
  checkForUpdateQuietly,
  updateChannel,
  type AvailableUpdate,
  type DownloadProgress,
  type UpdateChannel,
} from "@/lib/update";

/**
 * Whether a newer lindo-md exists, and the act of installing it.
 *
 * One instance, held by `Shell`, shared by the launch prompt and the settings
 * panel. Two instances would mean two checks on every launch and two answers
 * that could disagree — and, worse, the reader could start a download in one
 * surface and watch the other still offer to start it.
 */

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  /** Only ever reached from `checkNow`. The launch check does not claim this:
   *  see `checkForUpdateQuietly`, which cannot tell "current" from "offline",
   *  and a laptop on a plane should not be told it is up to date. */
  | { status: "current" }
  | { status: "available"; update: AvailableUpdate }
  | { status: "downloading"; update: AvailableUpdate; progress: DownloadProgress }
  | { status: "failed"; message: string };

export interface Updater {
  channel: UpdateChannel;
  state: UpdateState;
  /**
   * The update the launch check found, until it is dismissed.
   *
   * Distinct from `state` so the dialog opens for a check the reader did not
   * ask for and stays shut for one they did — a modal appearing on top of the
   * settings panel that just answered the same question is a bug, not a
   * notification. Set at most once per launch, so declining an update does not
   * mean being asked again ten minutes later.
   */
  prompt: AvailableUpdate | null;
  dismissPrompt: () => void;
  checkNow: () => void;
  install: (update: AvailableUpdate) => void;
}

export function useUpdater(enabled: boolean): Updater {
  const channel = updateChannel(useHostPlatform());
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [prompt, setPrompt] = useState<AvailableUpdate | null>(null);

  /** The launch check is once per run of the app, not once per render and not
   *  once per toggle of the setting. */
  const checkedOnLaunch = useRef(false);

  useEffect(() => {
    if (!enabled || channel !== "in-app" || checkedOnLaunch.current) return;
    checkedOnLaunch.current = true;

    void checkForUpdateQuietly().then((update) => {
      if (!update) return;
      setState({ status: "available", update });
      setPrompt(update);
    });
  }, [enabled, channel]);

  const dismissPrompt = useCallback(() => {
    setPrompt(null);
  }, []);

  const checkNow = useCallback(() => {
    setState({ status: "checking" });
    checkForUpdate().then(
      (update) => {
        setState(update ? { status: "available", update } : { status: "current" });
      },
      (error: unknown) => {
        setState({ status: "failed", message: messageFor(error) });
      },
    );
  }, []);

  const install = useCallback((update: AvailableUpdate) => {
    setState({ status: "downloading", update, progress: NOT_STARTED });
    update
      .install((progress) => {
        setState({ status: "downloading", update, progress });
      })
      .then(
        () => {
          // Only reached if the relaunch did not happen — normally the process
          // is gone before this runs. Landing back on "available" leaves the
          // reader a button rather than a progress bar frozen at 100%.
          setState({ status: "available", update });
        },
        (error: unknown) => {
          setState({ status: "failed", message: messageFor(error) });
        },
      );
  }, []);

  return { channel, state, prompt, dismissPrompt, checkNow, install };
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
