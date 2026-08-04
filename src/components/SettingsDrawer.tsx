import * as Dialog from "@radix-ui/react-dialog";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Download, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  ColorSwatch,
  Field,
  Row,
  Section,
  Select,
  Slider,
  Switch,
  type SelectOption,
} from "@/components/ui/controls";
import {
  readThemeFile,
  writeThemeFile,
  type AppConfig,
  type AppearanceMode,
} from "@/lib/ipc";
import { PRESETS } from "@/lib/theme/presets";
import { forkTheme, parseThemeFile, serializeTheme } from "@/lib/theme/io";
import type { Theme, ThemeColors, ThemeTypography } from "@/lib/theme/schema";
import { cn } from "@/lib/utils";

/**
 * Everything about how the document looks, in one panel.
 *
 * Editing any control forks the active preset into a custom theme rather than
 * mutating it, so "Nord" is always still Nord to go back to. The panel writes
 * through to settings on every change — there is no Apply button, because the
 * document behind the drawer *is* the preview.
 */

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AppConfig;
  theme: Theme;
  onUpdateConfig: (patch: Partial<AppConfig>) => void;
}

const BODY_FONTS: SelectOption[] = [
  { value: '"Source Serif 4 Variable", Georgia, serif', label: "Source Serif 4" },
  { value: '"Literata Variable", Georgia, serif', label: "Literata" },
  { value: '"Newsreader Variable", Georgia, serif', label: "Newsreader" },
  { value: '"EB Garamond Variable", Georgia, serif', label: "EB Garamond" },
  { value: '"Lora Variable", Georgia, serif', label: "Lora" },
  { value: '"Inter Variable", system-ui, sans-serif', label: "Inter" },
  { value: '"Inter Tight Variable", system-ui, sans-serif', label: "Inter Tight" },
  { value: '"Source Sans 3 Variable", system-ui, sans-serif', label: "Source Sans 3" },
  { value: '"IBM Plex Sans", system-ui, sans-serif', label: "IBM Plex Sans" },
  { value: '"Atkinson Hyperlegible", system-ui, sans-serif', label: "Atkinson Hyperlegible" },
  { value: "system-ui, sans-serif", label: "System UI" },
].map((option) => ({ ...option, fontFamily: option.value }));

const MONO_FONTS: SelectOption[] = [
  { value: '"JetBrains Mono Variable", ui-monospace, monospace', label: "JetBrains Mono" },
  { value: '"Source Code Pro Variable", ui-monospace, monospace', label: "Source Code Pro" },
  { value: '"IBM Plex Mono", ui-monospace, monospace', label: "IBM Plex Mono" },
  { value: "ui-monospace, monospace", label: "System Monospace" },
].map((option) => ({ ...option, fontFamily: option.value }));

const COLOR_FIELDS: Array<{ key: keyof Omit<ThemeColors, "alert">; label: string }> = [
  { key: "bg", label: "Page" },
  { key: "surface", label: "Raised surface" },
  { key: "text", label: "Body text" },
  { key: "textMuted", label: "Muted text" },
  { key: "heading", label: "Headings" },
  { key: "link", label: "Links" },
  { key: "linkHover", label: "Links (hover)" },
  { key: "border", label: "Rules and borders" },
  { key: "codeBg", label: "Code background" },
  { key: "codeBorder", label: "Code border" },
  { key: "accent", label: "Accent" },
  { key: "quoteBar", label: "Quote bar" },
  { key: "selection", label: "Selection" },
];

export function SettingsDrawer({
  open,
  onOpenChange,
  config,
  theme,
  onUpdateConfig,
}: SettingsDrawerProps) {
  const [status, setStatus] = useState<string | null>(null);

  const customIds = useMemo(
    () => config.customThemes.map((custom) => custom.id),
    [config.customThemes],
  );

  /** Applies an edit to the active theme, forking it into a custom one first. */
  const edit = (change: (theme: Theme) => Theme) => {
    const forked = change(forkTheme(theme, customIds));
    const others = config.customThemes.filter((custom) => custom.id !== forked.id);
    onUpdateConfig({
      customThemes: [...others, forked],
      themeId: forked.id,
    });
  };

  const editType = (patch: Partial<ThemeTypography>) =>
    edit((current) => ({
      ...current,
      typography: { ...current.typography, ...patch },
    }));

  const editColor = (key: keyof Omit<ThemeColors, "alert">, value: string) =>
    edit((current) => ({
      ...current,
      colors: { ...current.colors, [key]: value },
    }));

  const type = theme.typography;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/25" />
        <Dialog.Content
          className={cn(
            "fixed top-0 right-0 z-50 flex h-full w-[320px] flex-col bg-ui-base",
            "shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.6)]",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
            "duration-[var(--ui-dur-panel)]",
          )}
        >
          <div className="flex h-[var(--ui-titlebar-h)] shrink-0 items-center justify-between px-4">
            <Dialog.Title className="text-[13px] text-ui-text-strong">
              Appearance
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close appearance settings"
              className="grid size-7 place-items-center rounded-ui-sm text-ui-text-muted hover:bg-ui-plane-1 hover:text-ui-text-strong"
            >
              <X size={15} strokeWidth={1.5} aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Choose a theme and adjust the fonts, sizes, spacing and colors the
            document is rendered with.
          </Dialog.Description>

          <div className="min-h-0 flex-1 overflow-y-auto pb-6">
            <Section title="Theme">
              <ThemeGallery
                activeId={config.themeId}
                onPick={(id) => onUpdateConfig({ themeId: id })}
              />
            </Section>

            <Section title="Appearance">
              <div className="flex gap-1">
                {(["light", "dark", "system"] as AppearanceMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onUpdateConfig({ appearance: mode })}
                    className={cn(
                      "flex-1 rounded-ui-md py-1.5 text-[12px] capitalize",
                      "transition-colors duration-[var(--ui-dur)]",
                      config.appearance === mode
                        ? "bg-ui-ember-wash text-ui-text-strong"
                        : "bg-ui-plane-1 text-ui-text-muted hover:text-ui-text",
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Type">
              <Field label="Body">
                <Select
                  label="Body font"
                  value={type.bodyFont}
                  options={BODY_FONTS}
                  onChange={(bodyFont) => editType({ bodyFont })}
                />
              </Field>
              <Field label="Headings">
                <Select
                  label="Heading font"
                  value={type.headingFont}
                  options={BODY_FONTS}
                  onChange={(headingFont) => editType({ headingFont })}
                />
              </Field>
              <Field label="Code">
                <Select
                  label="Monospace font"
                  value={type.monoFont}
                  options={MONO_FONTS}
                  onChange={(monoFont) => editType({ monoFont })}
                />
              </Field>
              <Field label="Size" value={`${type.baseSize.toFixed(1)}px`}>
                <Slider
                  label="Body size"
                  value={type.baseSize}
                  min={13}
                  max={28}
                  step={0.5}
                  onChange={(baseSize) => editType({ baseSize })}
                />
              </Field>
              <Field label="Heading scale" value={type.scale.toFixed(2)}>
                <Slider
                  label="Heading scale"
                  value={type.scale}
                  min={1}
                  max={1.5}
                  step={0.01}
                  onChange={(scale) => editType({ scale })}
                />
              </Field>
              <Field label="Heading weight" value={String(type.headingWeight)}>
                <Slider
                  label="Heading weight"
                  value={type.headingWeight}
                  min={300}
                  max={900}
                  step={50}
                  onChange={(headingWeight) => editType({ headingWeight })}
                />
              </Field>
            </Section>

            <Section title="Layout">
              <Field label="Line height" value={type.lineHeight.toFixed(2)}>
                <Slider
                  label="Line height"
                  value={type.lineHeight}
                  min={1.2}
                  max={2.2}
                  step={0.01}
                  onChange={(lineHeight) => editType({ lineHeight })}
                />
              </Field>
              <Field label="Measure" value={`${Math.round(type.measure)} ch`}>
                <Slider
                  label="Line length"
                  value={type.measure}
                  min={40}
                  max={120}
                  step={1}
                  onChange={(measure) => editType({ measure })}
                />
              </Field>
              <Field label="Paragraph spacing" value={`${type.paragraphSpacing.toFixed(2)} em`}>
                <Slider
                  label="Paragraph spacing"
                  value={type.paragraphSpacing}
                  min={0}
                  max={3}
                  step={0.05}
                  onChange={(paragraphSpacing) => editType({ paragraphSpacing })}
                />
              </Field>
              <Field label="Letter spacing" value={`${type.letterSpacing.toFixed(3)} em`}>
                <Slider
                  label="Letter spacing"
                  value={type.letterSpacing}
                  min={-0.05}
                  max={0.15}
                  step={0.005}
                  onChange={(letterSpacing) => editType({ letterSpacing })}
                />
              </Field>
              <Row label="Justify text">
                <Switch
                  label="Justify text"
                  checked={type.justify}
                  onChange={(justify) => editType({ justify })}
                />
              </Row>
            </Section>

            <Section title="Code">
              <Row label="Line numbers">
                <Switch
                  label="Show line numbers"
                  checked={theme.code.lineNumbers}
                  onChange={(lineNumbers) =>
                    edit((current) => ({
                      ...current,
                      code: { ...current.code, lineNumbers },
                    }))
                  }
                />
              </Row>
            </Section>

            <Section title="Colors">
              {COLOR_FIELDS.map(({ key, label }) => (
                <ColorSwatch
                  key={key}
                  label={label}
                  value={theme.colors[key]}
                  onChange={(value) => editColor(key, value)}
                />
              ))}
            </Section>

            <Section title="Reading">
              <Row label="Block remote images">
                <Switch
                  label="Block remote images"
                  checked={config.blockRemoteImages}
                  onChange={(blockRemoteImages) => onUpdateConfig({ blockRemoteImages })}
                />
              </Row>
              <Row label="Respect .gitignore">
                <Switch
                  label="Respect gitignore when scanning folders"
                  checked={config.respectGitignore}
                  onChange={(respectGitignore) => onUpdateConfig({ respectGitignore })}
                />
              </Row>
            </Section>

            <Section title="Theme file">
              <div className="flex gap-2 pt-1">
                <PanelButton
                  icon={Download}
                  label="Export"
                  onClick={() => void exportTheme(theme, setStatus)}
                />
                <PanelButton
                  icon={Upload}
                  label="Import"
                  onClick={() =>
                    void importTheme(config, onUpdateConfig, setStatus)
                  }
                />
              </div>
              {status && (
                <p className="pt-2 text-[11.5px] text-ui-text-faint">{status}</p>
              )}
            </Section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Swatch cards rather than a dropdown: a theme is a look, and a list of names
 *  makes the reader open each one to find out what it is. */
function ThemeGallery({
  activeId,
  onPick,
}: {
  activeId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 pt-1">
      {PRESETS.map((preset) => {
        const isActive = preset.id === activeId;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onPick(preset.id)}
            title={preset.note}
            className={cn(
              "overflow-hidden rounded-ui-md text-left transition-colors duration-[var(--ui-dur)]",
              isActive ? "bg-ui-ember-wash" : "bg-ui-plane-1 hover:bg-ui-plane-2",
            )}
          >
            <span className="flex h-7 w-full">
              {[preset.light, preset.dark].map((half) => (
                <span
                  key={half.id}
                  className="flex flex-1 items-center gap-1 px-2"
                  style={{ background: half.colors.bg }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: half.colors.link }}
                  />
                  <span
                    className="h-[3px] flex-1 rounded-full"
                    style={{ background: half.colors.text, opacity: 0.7 }}
                  />
                </span>
              ))}
            </span>
            <span
              className={cn(
                "block truncate px-2 py-1 text-[11.5px]",
                isActive ? "text-ui-text-strong" : "text-ui-text-muted",
              )}
            >
              {preset.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PanelButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Download;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-ui-md bg-ui-plane-1 py-1.5",
        "text-[12px] text-ui-text transition-colors duration-[var(--ui-dur)]",
        "hover:bg-ui-plane-2 hover:text-ui-text-strong",
      )}
    >
      <Icon size={13} strokeWidth={1.5} aria-hidden />
      {label}
    </button>
  );
}

async function exportTheme(
  theme: Theme,
  setStatus: (status: string | null) => void,
): Promise<void> {
  const path = await saveFileDialog({
    title: "Export theme",
    defaultPath: `${theme.id}.pretty-md-theme.json`,
    filters: [{ name: "pretty-md theme", extensions: ["json"] }],
  });
  if (!path) return;

  // Through an allowlisted command, not a webview filesystem permission — see
  // `src-tauri/src/export.rs`.
  await writeThemeFile(path, serializeTheme(theme));
  setStatus(`Exported to ${path}`);
}

async function importTheme(
  config: AppConfig,
  onUpdateConfig: (patch: Partial<AppConfig>) => void,
  setStatus: (status: string | null) => void,
): Promise<void> {
  const path = await openFileDialog({
    title: "Import theme",
    multiple: false,
    filters: [{ name: "pretty-md theme", extensions: ["json"] }],
  });
  if (typeof path !== "string") return;

  const { theme, error } = parseThemeFile(await readThemeFile(path));

  if (!theme) {
    setStatus(error);
    return;
  }

  const others = config.customThemes.filter((custom) => custom.id !== theme.id);
  onUpdateConfig({
    customThemes: [...others, theme],
    themeId: theme.id,
  });
  setStatus(`Imported "${theme.name}".`);
}
