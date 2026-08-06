import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

import type { HostPlatform } from "@/hooks/useHostPlatform";

/**
 * The one place lindo-md talks to the network.
 *
 * Everything else in this app is local by construction — rendering, scanning,
 * watching, exporting — so this module is the whole answer to "does it use the
 * internet". It is a GET of a JSON manifest on GitHub, made by Rust rather than
 * by the webview, and it happens only when `config.checkForUpdates` is on.
 *
 * What makes it safe to install what it finds is not this file. Every updater
 * artifact is signed with a minisign key whose private half exists only inside
 * the release workflow, and `tauri-plugin-updater` verifies that signature in
 * Rust before anything is unpacked or run. A compromised GitHub release, a
 * hijacked DNS answer or a proxy rewriting the manifest all fail the same way:
 * the signature does not match the public key baked into `tauri.conf.json`, and
 * the update is refused. That check is not skippable from here.
 */

/**
 * How a given build of lindo-md gets its next version.
 *
 * `in-app` is the published Windows and Linux bundles: an update is a signed
 * artifact named in `latest.json`, so the app can fetch, verify and install it
 * on its own.
 *
 * `source` is macOS, and it is a consequence of the release, not a preference.
 * `release.yml` publishes no macOS bundle — an unsigned one fails Gatekeeper in
 * a way that reads as a corrupt download — so `latest.json` carries no `darwin`
 * entry and `check()` has nothing to compare against. A macOS copy of lindo-md
 * was compiled by the person running it, which is also why it works: a binary
 * you built yourself was never downloaded, so it was never quarantined. Its
 * update path is the one that produced it in the first place.
 */
export type UpdateChannel = "in-app" | "source";

export function updateChannel(host: HostPlatform): UpdateChannel {
  return host === "macos" ? "source" : "in-app";
}

/** What a `source`-channel user runs to get the new version. Shown rather than
 *  executed: the app has no shell permission, and building is not something to
 *  start behind someone's back. */
export const SOURCE_UPDATE_COMMAND = "git pull && pnpm install && pnpm tauri build";

export interface AvailableUpdate {
  /** The version on offer, e.g. `1.2.0`. Never the running one — the plugin
   *  reports nothing when they match. */
  version: string;
  /** The release body, or null when it is absent or empty. */
  notes: string | null;
  /**
   * Downloads, verifies, installs, and restarts into the new version.
   *
   * Resolves only if the restart did not happen; on both platforms that can
   * reach here the process is normally replaced before the promise settles.
   */
  install: (onProgress: (progress: DownloadProgress) => void) => Promise<void>;
}

/**
 * Asks whether a newer release exists.
 *
 * Returns null both when the app is current and when the check could not be
 * made — an offline laptop, a blocked domain, a rate-limited GitHub. That is
 * deliberate: a failed check is not a thing the reader did wrong and not a
 * state worth a dialog, and the difference between "up to date" and "could not
 * ask" does not change what anyone would do next. `checkNow` in the settings
 * panel is the one caller that wants to tell them apart, so it uses
 * `checkForUpdate` and lets the rejection through.
 */
export async function checkForUpdateQuietly(): Promise<AvailableUpdate | null> {
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}

/** As `checkForUpdateQuietly`, but a failure to reach GitHub rejects rather than
 *  reading as "up to date". */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const update = await check();
  if (!update) return null;
  return describe(update);
}

function describe(update: Update): AvailableUpdate {
  // A release published with an empty body is "no notes", not a blank panel with
  // a heading over it — so whitespace-only collapses to the same null as absent.
  const body = update.body?.trim();
  return {
    version: update.version,
    notes: body === undefined || body === "" ? null : body,
    install: (onProgress) => install(update, onProgress),
  };
}

async function install(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  let progress = NOT_STARTED;
  await update.downloadAndInstall((event: DownloadEvent) => {
    progress = advance(progress, event);
    onProgress(progress);
  });
  // Reached on Linux, where the AppImage has been swapped underneath a process
  // that is still running the old one. On Windows the NSIS installer has already
  // taken the app down and brought it back by the time this would run, so this is
  // a no-op there rather than a second restart.
  await relaunch();
}

// --- download progress ------------------------------------------------------

/**
 * How far the download has got.
 *
 * A value rather than three `useState`s in the dialog, and a pure `advance`
 * rather than accumulation inside the event callback, because the arithmetic is
 * the part that can be wrong: the plugin reports *chunk* lengths, not a running
 * total, so a component that forgets to accumulate shows a bar that flickers at
 * near-zero for the whole download and looks like a hang.
 */
export interface DownloadProgress {
  /** Bytes received so far. */
  received: number;
  /** Total bytes, or null when the server sent no `Content-Length`. */
  total: number | null;
  /**
   * 0–1, or null when the total is unknown and the bar must be indeterminate.
   *
   * Clamped: a `Content-Length` that undercounts is a server's mistake, and it
   * must not become a progress bar that runs off the end of its track.
   */
  fraction: number | null;
}

export const NOT_STARTED: DownloadProgress = { received: 0, total: null, fraction: null };

export function advance(state: DownloadProgress, event: DownloadEvent): DownloadProgress {
  switch (event.event) {
    case "Started": {
      const length = event.data.contentLength ?? 0;
      const total = length > 0 ? length : null;
      return { received: 0, total, fraction: total === null ? null : 0 };
    }
    case "Progress": {
      const received = state.received + event.data.chunkLength;
      return {
        received,
        total: state.total,
        fraction: state.total === null ? null : Math.min(received / state.total, 1),
      };
    }
    case "Finished":
      // The bar completes even when the length was unknown — arriving at "done"
      // is the one thing an indeterminate download can still report honestly.
      return { received: state.received, total: state.total, fraction: 1 };
  }
}
