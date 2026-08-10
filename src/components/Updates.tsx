import * as Dialog from "@radix-ui/react-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";

import { Row, Section, Switch } from "@/components/ui/controls";
import type { Updater } from "@/hooks/useUpdater";
import { SOURCE_UPDATE_COMMAND, type DownloadProgress } from "@/lib/update";
import { cn } from "@/lib/utils";

/**
 * The whole update surface: the dialog that offers a new version, and the
 * settings section that lets someone ask for one or stop being asked.
 *
 * One file because they are one feature with one piece of state (`Updater`) and
 * two viewports onto it. Split across `AboutDialog` and `SettingsDialog` they
 * would drift — the dialog would learn about a download state the settings
 * section still rendered as a button.
 */

const RELEASES = "https://github.com/gabmichels/lindo-md/releases";

/**
 * Offered on launch when a newer version exists, and never twice in one run.
 *
 * A modal rather than a banner because the reader has one decision to make and
 * it takes one click; a dismissible strip above the document would occupy the
 * chrome permanently for a question that is answered once. `Later` is a real
 * answer — it closes and does not come back until the next launch.
 */
export function UpdateDialog({ updater }: { updater: Updater }) {
  const { prompt, state, install, dismissPrompt } = updater;
  const current = useCurrentVersion();

  // The dialog belongs to the prompt, but it renders `state` — so a download
  // started here keeps its progress bar rather than closing on the first click.
  const downloading = state.status === "downloading" ? state.progress : null;
  const failure = state.status === "failed" ? state.message : null;

  return (
    <Dialog.Root
      open={prompt !== null}
      onOpenChange={(open) => {
        // Not while a download is in flight: dismissing the only progress
        // indicator leaves the app about to restart with nothing having said so.
        if (!open && !downloading) dismissPrompt();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[420px] max-w-[calc(100vw-48px)]",
            "-translate-x-1/2 -translate-y-1/2",
            "rounded-ui-lg bg-ui-plane-1 p-5 shadow-2xl",
          )}
        >
          <Dialog.Title className="text-[15px] text-ui-text-strong">
            lindo-md {prompt?.version} is available
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-ui-text-muted">
            {current ? `You are on ${current}.` : "A newer version has been published."} It is
            downloaded, checked against lindo-md&rsquo;s release signature, and installed here —
            nothing to download by hand.
          </Dialog.Description>

          {prompt?.notes && <ReleaseNotes notes={prompt.notes} />}

          {downloading && <ProgressBar progress={downloading} />}
          {failure && <Failure message={failure} />}

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                openUrl(RELEASES).catch((error: unknown) => {
                  console.error("lindo-md: could not open the releases page", error);
                });
              }}
              className="text-[12px] text-ui-accent hover:underline"
            >
              Release notes
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={downloading !== null}
                onClick={dismissPrompt}
                className={cn(
                  "rounded-ui-md px-3 py-1.5 text-[12px] text-ui-text-muted",
                  "transition-colors duration-[var(--ui-dur)] hover:text-ui-text",
                  "disabled:pointer-events-none disabled:opacity-30",
                )}
              >
                Later
              </button>
              <button
                type="button"
                disabled={downloading !== null || prompt === null}
                onClick={() => {
                  if (prompt) install(prompt);
                }}
                className={cn(
                  "rounded-ui-md bg-ui-plane-2 px-3 py-1.5 text-[12px] text-ui-text-strong",
                  "transition-colors duration-[var(--ui-dur)] hover:bg-ui-accent-wash",
                  "disabled:pointer-events-none disabled:opacity-40",
                )}
              >
                {downloading ? "Installing…" : "Install and restart"}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Settings → General.
 *
 * Two different panels depending on the channel, because the honest answer
 * differs by platform: a published build can update itself, and a macOS build
 * came from a `git clone` that is still the way to update it.
 */
export function UpdatesSection({
  updater,
  checkForUpdates,
  onChangeCheckForUpdates,
}: {
  updater: Updater;
  checkForUpdates: boolean;
  onChangeCheckForUpdates: (checked: boolean) => void;
}) {
  const current = useCurrentVersion();

  if (updater.channel === "source") {
    return (
      <Section title="Updates">
        <p className="py-1 text-[12.5px] text-ui-text">
          {current ? `You are on ${current}, built from source.` : "This build came from source."}
        </p>
        <pre className="mt-1 overflow-x-auto rounded-ui-md bg-ui-plane-2 px-3 py-2 text-[11.5px] text-ui-text">
          <code>{SOURCE_UPDATE_COMMAND}</code>
        </pre>
        <Note>
          No macOS bundle is published — an unsigned one fails Gatekeeper in a way that looks like a
          broken download — so there is nothing for the app to install. Rebuilding is also why this
          copy opens without a warning: a binary you compiled was never downloaded, so it was never
          quarantined.
        </Note>
      </Section>
    );
  }

  return (
    <Section title="Updates">
      <Row label="Check for updates on launch">
        <Switch
          label="Check for updates on launch"
          checked={checkForUpdates}
          onChange={onChangeCheckForUpdates}
        />
      </Row>
      <Note>
        The only request lindo-md ever makes. Everything else — rendering, scanning folders,
        watching for changes, exporting — happens on this machine, so turning this off means the app
        opens no connections at all.
      </Note>
      <div className="pt-2">
        <CheckStatus updater={updater} current={current} />
      </div>
    </Section>
  );
}

function CheckStatus({ updater, current }: { updater: Updater; current: string | null }) {
  const { state, checkNow, install } = updater;

  switch (state.status) {
    case "downloading":
      return (
        <>
          <p className="text-[12.5px] text-ui-text">Installing {state.update.version}…</p>
          <ProgressBar progress={state.progress} />
        </>
      );

    case "available":
      return (
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-ui-text">
            {state.update.version} is available
            {current && <span className="text-ui-text-faint"> — you are on {current}</span>}
          </span>
          <button
            type="button"
            onClick={() => {
              install(state.update);
            }}
            className={cn(
              "ml-auto rounded-ui-md bg-ui-plane-2 px-3 py-1.5 text-[12px] text-ui-text-strong",
              "transition-colors duration-[var(--ui-dur)] hover:bg-ui-accent-wash",
            )}
          >
            Install and restart
          </button>
        </div>
      );

    case "failed":
      return (
        <>
          <CheckButton label="Try again" onClick={checkNow} />
          <Failure message={state.message} />
        </>
      );

    case "checking":
      return <p className="py-1.5 text-[12.5px] text-ui-text-muted">Checking…</p>;

    case "current":
      return (
        <div className="flex items-center gap-3">
          <CheckButton label="Check now" onClick={checkNow} />
          <span className="text-[12px] text-ui-text-faint">
            {current ? `${current} is the latest version.` : "You are up to date."}
          </span>
        </div>
      );

    case "idle":
      return <CheckButton label="Check now" onClick={checkNow} />;
  }
}

function CheckButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-ui-md bg-ui-plane-2 px-3 py-1.5 text-[12px] text-ui-text",
        "transition-colors duration-[var(--ui-dur)] hover:text-ui-text-strong",
      )}
    >
      {label}
    </button>
  );
}

/**
 * The release body, as the plain text it was written as.
 *
 * Not run through the Markdown pipeline: that lives in Rust behind
 * `open_document`, which takes a path, and this string arrived over the network.
 * Rendering remote Markdown as HTML in the chrome would also put untrusted
 * content inside the one surface `--ui-*` owns, which DESIGN.md does not allow
 * and no release note needs.
 */
function ReleaseNotes({ notes }: { notes: string }) {
  return (
    <div className="ui-scroller mt-4 max-h-[180px] overflow-y-auto rounded-ui-md bg-ui-plane-2 px-3 py-2">
      <p className="text-[11.5px] leading-[1.55] whitespace-pre-wrap text-ui-text-muted">{notes}</p>
    </div>
  );
}

/**
 * Determinate where the server sent a length, indeterminate where it did not.
 *
 * Neutral rather than the accent: DESIGN.md spends it on four things and a
 * download is not one of them. The bar reads perfectly well in `--ui-text`, and
 * an accent here would compete with the active-file marker for no gain.
 */
function ProgressBar({ progress }: { progress: DownloadProgress }) {
  const percent = progress.fraction === null ? null : Math.round(progress.fraction * 100);

  return (
    <div className="mt-3">
      <div
        role="progressbar"
        aria-label="Downloading the update"
        aria-valuemin={0}
        aria-valuemax={100}
        // Omitted entirely when the length is unknown — that is what tells a
        // screen reader the bar is indeterminate, rather than stuck at zero.
        aria-valuenow={percent ?? undefined}
        className="h-1 overflow-hidden rounded-full bg-ui-sunken"
      >
        <div
          className={cn(
            "h-full rounded-full bg-ui-text transition-[width] duration-[var(--ui-dur)]",
            percent === null && "w-1/3 animate-pulse",
          )}
          style={percent === null ? undefined : { width: `${String(percent)}%` }}
        />
      </div>
      <p className="pt-1.5 text-[11.5px] text-ui-text-faint tabular-nums">
        {percent === null ? "Downloading…" : `${String(percent)}%`}
        {progress.fraction === 1 && " — restarting"}
      </p>
    </div>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <p className="pt-2 text-[11.5px] leading-[1.5] text-ui-danger">
      Could not complete the update: {message}
    </p>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-[11.5px] leading-[1.5] text-ui-text-faint">{children}</p>;
}

/** The running version, or null outside a Tauri host — the specimen route runs
 *  in a browser, where `getVersion` has nothing to answer with. */
function useCurrentVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion, () => undefined);
  }, []);
  return version;
}
