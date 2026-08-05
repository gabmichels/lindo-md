import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { Check, Minus, Palette, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Row, Section, Switch } from "@/components/ui/controls";
import type { ConfigPatch } from "@/hooks/useConfig";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, stepZoom } from "@/lib/zoom";
import {
  getDefaultAppStatus,
  requestDefaultApp,
  type AppConfig,
  type DefaultAppStatus,
} from "@/lib/ipc";
import { cn } from "@/lib/utils";

/**
 * Everything about how the app behaves — as opposed to how the document looks,
 * which is the appearance drawer's job.
 *
 * The split is not filing for its own sake. The drawer is deliberately non-modal
 * because the document behind it is the live preview of every control in it.
 * Nothing here has a preview: no one needs to watch a paragraph while deciding
 * whether the rail shows dotfiles. So this is a plain modal dialog, and the two
 * surfaces stop competing to be one panel that is wrong for half its contents.
 */

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AppConfig;
  onUpdateConfig: (patch: ConfigPatch) => void;
  /** Hands off to the appearance drawer, so the dialog can point at it rather
   *  than duplicating a theme picker. */
  onOpenAppearance: () => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  config,
  onUpdateConfig,
  onOpenAppearance,
}: SettingsDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex w-[560px] max-w-[calc(100vw-48px)]",
            "-translate-x-1/2 -translate-y-1/2 flex-col",
            // `overflow-hidden` so the scrolling body is clipped by the corner
            // radius instead of squaring it off at the bottom edge.
            "overflow-hidden rounded-ui-lg bg-ui-plane-1 shadow-2xl",
          )}
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-1">
            <Dialog.Title className="text-[15px] text-ui-text-strong">Settings</Dialog.Title>
            <Dialog.Close
              aria-label="Close settings"
              className="grid size-7 place-items-center rounded-ui-sm text-ui-text-muted hover:bg-ui-plane-2 hover:text-ui-text-strong"
            >
              <X size={15} strokeWidth={1.5} aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            File associations, startup, reading and file-tree behavior. Fonts, colors and spacing
            live in the appearance panel.
          </Dialog.Description>

          <Tabs.Root defaultValue="general" className="flex min-h-0 flex-col">
            <Tabs.List aria-label="Settings sections" className="flex gap-1 px-5 pb-1">
              <Tab value="general" label="General" />
              <Tab value="reading" label="Reading" />
              <Tab value="files" label="Files" />
            </Tabs.List>

            {/* A fixed height rather than one that fits each tab: a dialog that
                resizes as you move between tabs moves its own tab strip out from
                under the pointer. */}
            <div className="ui-scroller h-[356px] overflow-y-auto px-1 pb-4">
              <Tabs.Content value="general" className="outline-none">
                <DefaultAppSection open={open} />

                <Section title="Startup">
                  <Row label="Reopen the last tabs">
                    <Switch
                      label="Reopen the tabs from last time on launch"
                      checked={config.reopenLastDocument}
                      onChange={(reopenLastDocument) => {
                        onUpdateConfig({ reopenLastDocument });
                      }}
                    />
                  </Row>
                  <Note>
                    Every tab comes back, in its groups. A file you double-click opens alongside
                    them rather than instead of them.
                  </Note>
                </Section>
              </Tabs.Content>

              <Tabs.Content value="reading" className="outline-none">
                <Section title="Zoom">
                  <ZoomControl
                    zoom={config.zoom}
                    onStep={(delta) => {
                      onUpdateConfig((current) => ({
                        zoom: stepZoom(current.zoom, delta),
                      }));
                    }}
                    onReset={() => {
                      onUpdateConfig({ zoom: 1 });
                    }}
                  />
                  <Note>
                    Scales the document without changing the theme, so an exported file keeps the
                    theme&rsquo;s own size.
                  </Note>
                </Section>

                <Section title="Text">
                  <Row label="Smart punctuation">
                    <Switch
                      label="Smart punctuation"
                      checked={config.smartPunctuation}
                      onChange={(smartPunctuation) => {
                        onUpdateConfig({ smartPunctuation });
                      }}
                    />
                  </Row>
                  <Note>
                    Turns straight quotes curly and <code>--</code> into an en dash. Off by default
                    because it rewrites the author&rsquo;s text. Takes effect the next time a
                    document is opened.
                  </Note>
                </Section>

                <Section title="Privacy">
                  <Row label="Block remote images">
                    <Switch
                      label="Block remote images"
                      checked={config.blockRemoteImages}
                      onChange={(blockRemoteImages) => {
                        onUpdateConfig({ blockRemoteImages });
                      }}
                    />
                  </Row>
                  <Note>
                    Remote images become a click-to-load placeholder, so opening an untrusted
                    document cannot phone home through a tracking pixel.
                  </Note>
                </Section>

                <Section title="Appearance">
                  <PanelButton
                    icon={Palette}
                    label="Open the appearance panel"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenAppearance();
                    }}
                  />
                  <Note>
                    Themes, fonts, sizes, spacing and colors — in a panel you can keep open while
                    reading, because the document behind it is the preview.
                  </Note>
                </Section>
              </Tabs.Content>

              <Tabs.Content value="files" className="outline-none">
                <Section title="The file tree">
                  <Row label="Respect .gitignore">
                    <Switch
                      label="Respect gitignore when scanning folders"
                      checked={config.respectGitignore}
                      onChange={(respectGitignore) => {
                        onUpdateConfig({ respectGitignore });
                      }}
                    />
                  </Row>
                  <Row label="Show hidden files">
                    <Switch
                      label="Show hidden files and folders"
                      checked={config.showHiddenFiles}
                      onChange={(showHiddenFiles) => {
                        onUpdateConfig({ showHiddenFiles });
                      }}
                    />
                  </Row>
                  <Note>
                    The rail lists Markdown files only. Folders with none at any depth are left out,
                    so opening a source repository shows its docs rather than its source layout.
                  </Note>
                </Section>
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Tab({ value, label }: { value: string; label: string }) {
  return (
    <Tabs.Trigger
      value={value}
      className={cn(
        "rounded-ui-md px-2.5 py-1 text-[12.5px] text-ui-text-muted",
        "transition-colors duration-[var(--ui-dur)]",
        "hover:text-ui-text",
        "data-[state=active]:bg-ui-ember-wash data-[state=active]:text-ui-text-strong",
      )}
    >
      {label}
    </Tabs.Trigger>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-[11.5px] leading-[1.5] text-ui-text-faint">{children}</p>;
}

/**
 * Whether lindo-md opens `.md`, and a way to ask for it.
 *
 * The button cannot set the association — Windows blocks that for every
 * application, and forging the hash that protects it is what malware does. It
 * opens Settings at our own entry instead, which is why the copy says where the
 * user is going: a button that silently opens another window and appears to have
 * done nothing is worse than one that says it will.
 */
function DefaultAppSection({ open }: { open: boolean }) {
  const [status, setStatus] = useState<DefaultAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getDefaultAppStatus().then(setStatus, () => {
      setStatus(null);
    });
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // The user changes this in Windows Settings, in another window. Re-reading on
  // focus is what turns the row into a checkmark when they come back, instead of
  // leaving a stale "not the default" behind.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
    };
  }, [open, refresh]);

  if (!status?.supported) return null;

  return (
    <Section title="Markdown files">
      {status.isDefault ? (
        <p className="flex items-center gap-2 py-1 text-[12.5px] text-ui-text">
          <Check size={14} strokeWidth={2} className="text-ui-ember" aria-hidden />
          lindo-md opens Markdown files.
        </p>
      ) : (
        <>
          <p className="py-1 text-[12.5px] text-ui-text">
            Markdown files currently open in{" "}
            <span className="text-ui-text-strong">
              {status.currentHandler ?? "another application"}
            </span>
            .
          </p>
          <div className="pt-1">
            <PanelButton
              label="Make lindo-md the default"
              onClick={() => {
                setError(null);
                requestDefaultApp().catch((e: unknown) => {
                  setError(e instanceof Error ? e.message : String(e));
                });
              }}
            />
          </div>
        </>
      )}

      <Note>
        {status.isDefault
          ? "Windows only lets you change this from its own Settings app."
          : "Windows reserves this choice for its own Settings app, so this opens " +
            "it at lindo-md — pick “.md” there to finish."}
      </Note>
      {error && <p className="pt-1 text-[11.5px] text-ui-danger">{error}</p>}
    </Section>
  );
}

/** Stepper rather than a slider: zoom has one natural resting place — 100% — and
 *  a slider makes returning to it a matter of aim. */
function ZoomControl({
  zoom,
  onStep,
  onReset,
}: {
  zoom: number;
  /** A step rather than a value: the new zoom is computed from the current one
   *  at the moment it is applied, so clicking faster than React re-renders still
   *  advances once per click. */
  onStep: (delta: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <StepButton
        label="Zoom out"
        icon={Minus}
        disabled={zoom <= ZOOM_MIN}
        onClick={() => {
          onStep(-ZOOM_STEP);
        }}
      />
      <span className="min-w-[52px] text-center text-[12.5px] text-ui-text tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <StepButton
        label="Zoom in"
        icon={Plus}
        disabled={zoom >= ZOOM_MAX}
        onClick={() => {
          onStep(ZOOM_STEP);
        }}
      />
      <button
        type="button"
        onClick={onReset}
        disabled={zoom === 1}
        className={cn(
          "ml-1 rounded-ui-md px-2 py-1 text-[12px] text-ui-text-muted",
          "transition-colors duration-[var(--ui-dur)] hover:text-ui-text-strong",
          "disabled:pointer-events-none disabled:opacity-30",
        )}
      >
        Reset
      </button>
    </div>
  );
}

function StepButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Plus;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-ui-md bg-ui-plane-2 text-ui-text",
        "transition-colors duration-[var(--ui-dur)] hover:text-ui-text-strong",
        "disabled:pointer-events-none disabled:opacity-30",
      )}
    >
      <Icon size={14} strokeWidth={1.5} aria-hidden />
    </button>
  );
}

function PanelButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon?: typeof Palette;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-ui-md bg-ui-plane-2 px-3 py-1.5",
        "text-[12px] text-ui-text transition-colors duration-[var(--ui-dur)]",
        "hover:text-ui-text-strong",
      )}
    >
      {Icon && <Icon size={13} strokeWidth={1.5} aria-hidden />}
      {label}
    </button>
  );
}
