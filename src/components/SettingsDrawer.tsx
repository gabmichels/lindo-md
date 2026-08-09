import * as Dialog from "@radix-ui/react-dialog";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Download, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  ColorSwatch,
  Field,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  Switch,
  type SelectOption,
} from "@/components/ui/controls";
import { readThemeFile, writeThemeFile, type AppConfig, type AppearanceMode } from "@/lib/ipc";
import { BUNDLED_FONTS, type BundledFont } from "@/lib/theme/fonts";
import { PRESETS } from "@/lib/theme/presets";
import { forkTheme, parseThemeFile, serializeTheme } from "@/lib/theme/io";
import type {
  ContentWidth,
  Theme,
  ThemeColors,
  ThemeLayout,
  ThemeTypography,
} from "@/lib/theme/schema";
import { cn } from "@/lib/utils";
import { READING_SIZES } from "@/lib/zoom";

/**
 * Everything about how the document looks, in one panel.
 *
 * Editing any control forks the active preset into a custom theme rather than
 * mutating it, so "Nord" is always still Nord to go back to. The panel writes
 * through to settings on every change — there is no Apply button, because the
 * document behind the drawer *is* the preview.
 *
 * Only visual settings belong here, and that is what earns the drawer its
 * unusual shape: every control below changes something you can watch change.
 * Behavior — file associations, startup, the file tree — lives in
 * `SettingsDialog`, where a modal costs nothing because there is nothing to
 * preview.
 */

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AppConfig;
  theme: Theme;
  onUpdateConfig: (patch: Partial<AppConfig>) => void;
}

/**
 * The picker's lists, from `BUNDLED_FONTS` — which `scripts/fonts.mjs` writes
 * from the same manifest that generates the `@font-face` rules. A family cannot
 * be offered here without being bundled, or bundled without being offered.
 *
 * Every option previews in its own face. The system entries are last in each
 * list and preview in whatever the OS supplies, which is the honest preview.
 */
const GROUP_LABEL: Record<BundledFont["role"], string> = {
  serif: "Serif",
  sans: "Sans",
  mono: "Monospace",
};

function fontOptions(...roles: BundledFont["role"][]): SelectOption[] {
  return roles.flatMap((role) =>
    BUNDLED_FONTS.filter((font) => font.role === role).map((font) => ({
      value: font.value,
      label: font.label,
      fontFamily: font.value,
      group: GROUP_LABEL[role],
    })),
  );
}

const SYSTEM_SANS: SelectOption = {
  value: "system-ui, sans-serif",
  label: "System UI",
  fontFamily: "system-ui, sans-serif",
  group: "System",
};

const SYSTEM_MONO: SelectOption = {
  value: "ui-monospace, monospace",
  label: "System Monospace",
  fontFamily: "ui-monospace, monospace",
  group: "System",
};

const BODY_FONTS: SelectOption[] = [...fontOptions("serif", "sans"), SYSTEM_SANS];
const MONO_FONTS: SelectOption[] = [...fontOptions("mono"), SYSTEM_MONO];

const COLOR_FIELDS: { key: keyof Omit<ThemeColors, "alert">; label: string }[] = [
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

const WIDTHS: readonly { value: ContentWidth; label: string; title: string }[] = [
  { value: "standard", label: "Standard", title: "The page is the reading measure" },
  { value: "wide", label: "Wide", title: "Half again as wide — room for a table" },
  { value: "full", label: "Full", title: "Everything the window has" },
];

/**
 * The three sliders that decide how tightly the page is set, moved together.
 *
 * A preset here is not a stored setting — it writes the same values the sliders
 * below it write. One source of truth, and no way for the preset and the
 * sliders to disagree about what "compact" currently means.
 */
const DENSITIES: readonly {
  value: string;
  label: string;
  typography: Pick<ThemeTypography, "lineHeight" | "paragraphSpacing">;
  table: ThemeLayout["table"]["density"];
}[] = [
  {
    value: "compact",
    label: "Compact",
    typography: { lineHeight: 1.45, paragraphSpacing: 0.8 },
    table: "compact",
  },
  {
    value: "comfortable",
    label: "Comfortable",
    typography: { lineHeight: 1.62, paragraphSpacing: 1.15 },
    table: "comfortable",
  },
  {
    value: "spacious",
    label: "Spacious",
    typography: { lineHeight: 1.8, paragraphSpacing: 1.5 },
    table: "comfortable",
  },
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

  const editType = (patch: Partial<ThemeTypography>) => {
    edit((current) => ({
      ...current,
      typography: { ...current.typography, ...patch },
    }));
  };

  const editLayout = (patch: Partial<ThemeLayout>) => {
    edit((current) => ({
      ...current,
      layout: { ...current.layout, ...patch },
    }));
  };

  const editTable = (patch: Partial<ThemeLayout["table"]>) => {
    edit((current) => ({
      ...current,
      layout: {
        ...current.layout,
        table: { ...current.layout.table, ...patch },
      },
    }));
  };

  const editColor = (key: keyof Omit<ThemeColors, "alert">, value: string) => {
    edit((current) => ({
      ...current,
      colors: { ...current.colors, [key]: value },
    }));
  };

  /** One fork, both groups — otherwise the second edit would fork the first's
   *  result and leave a stray custom theme behind. */
  const applyDensity = (preset: (typeof DENSITIES)[number]) => {
    edit((current) => ({
      ...current,
      typography: { ...current.typography, ...preset.typography },
      layout: {
        ...current.layout,
        table: { ...current.layout.table, density: preset.table },
      },
    }));
  };

  const type = theme.typography;
  const layout = theme.layout;
  const density = DENSITIES.find(
    (preset) =>
      preset.typography.lineHeight === type.lineHeight &&
      preset.typography.paragraphSpacing === type.paragraphSpacing &&
      preset.table === layout.table.density,
  );

  return (
    // Deliberately not modal, and with no dimming overlay: the document behind
    // this panel is the live preview, and a scrim over it would mean judging a
    // theme through a grey filter. Non-modal also lets the reader scroll the
    // document to a table or a diagram while adjusting the type.
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          className={cn(
            "fixed top-0 right-0 z-50 flex h-full w-[320px] flex-col bg-ui-base",
            "shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.6)]",
            // Without a modal overlay Radix would otherwise let a click land on
            // the document behind; the panel keeps its own surface opaque.
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
            "duration-[var(--ui-dur-panel)]",
          )}
        >
          <div className="flex h-[var(--ui-titlebar-h)] shrink-0 items-center justify-between px-4">
            <Dialog.Title className="text-[13px] text-ui-text-strong">Appearance</Dialog.Title>
            <Dialog.Close
              aria-label="Close appearance settings"
              className="grid size-7 place-items-center rounded-ui-sm text-ui-text-muted hover:bg-ui-plane-1 hover:text-ui-text-strong"
            >
              <X size={15} strokeWidth={1.5} aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Choose a theme and adjust the fonts, sizes, spacing and colors the document is rendered
            with.
          </Dialog.Description>

          <div className="ui-scroller min-h-0 flex-1 overflow-y-auto pb-6">
            <Section title="Theme">
              <ThemeGallery
                activeId={config.themeId}
                onPick={(id) => {
                  onUpdateConfig({ themeId: id });
                }}
              />
            </Section>

            <Section title="Appearance">
              <Segmented<AppearanceMode>
                label="Appearance"
                value={config.appearance}
                onChange={(appearance) => {
                  onUpdateConfig({ appearance });
                }}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
              />
            </Section>

            {/* Width is a setting of the window, not of the theme — like zoom,
                and unlike everything below it. It writes to config rather than
                forking the theme, so a theme shared with someone reading on a
                laptop does not arrive full width. */}
            <Section title="Width">
              <Segmented<ContentWidth>
                label="Content width"
                value={config.contentWidth}
                onChange={(contentWidth) => {
                  onUpdateConfig({ contentWidth });
                }}
                options={WIDTHS}
              />
            </Section>

            {/* Beside Width because it is the same kind of setting — the window's,
                not the paper's — and because a reader who cannot read the page is
                looking for a size control, not a typography section. Nothing is
                highlighted when the zoom sits between the named sizes, which is
                where the stepper and Ctrl+= leave it; the same shape as Density
                below. */}
            <Section title="Reading size">
              <Segmented
                label="Reading size"
                value={READING_SIZES.find((size) => size.zoom === config.zoom)?.value ?? ""}
                onChange={(value) => {
                  const size = READING_SIZES.find((s) => s.value === value);
                  if (size) onUpdateConfig({ zoom: size.zoom });
                }}
                options={READING_SIZES}
              />
            </Section>

            <Section title="Type">
              <Field label="Body">
                <Select
                  label="Body font"
                  value={type.bodyFont}
                  options={BODY_FONTS}
                  onChange={(bodyFont) => {
                    editType({ bodyFont });
                  }}
                />
              </Field>
              <Field label="Headings">
                <Select
                  label="Heading font"
                  value={type.headingFont}
                  options={BODY_FONTS}
                  onChange={(headingFont) => {
                    editType({ headingFont });
                  }}
                />
              </Field>
              <Field label="Code">
                <Select
                  label="Monospace font"
                  value={type.monoFont}
                  options={MONO_FONTS}
                  onChange={(monoFont) => {
                    editType({ monoFont });
                  }}
                />
              </Field>
              <Field label="Size" value={`${type.baseSize.toFixed(1)}px`}>
                <Slider
                  label="Body size"
                  value={type.baseSize}
                  min={13}
                  max={28}
                  step={0.5}
                  onChange={(baseSize) => {
                    editType({ baseSize });
                  }}
                />
              </Field>
              <Field label="Heading scale" value={type.scale.toFixed(2)}>
                <Slider
                  label="Heading scale"
                  value={type.scale}
                  min={1}
                  max={1.5}
                  step={0.01}
                  onChange={(scale) => {
                    editType({ scale });
                  }}
                />
              </Field>
              <Field label="Heading weight" value={String(type.headingWeight)}>
                <Slider
                  label="Heading weight"
                  value={type.headingWeight}
                  min={300}
                  max={900}
                  step={50}
                  onChange={(headingWeight) => {
                    editType({ headingWeight });
                  }}
                />
              </Field>
            </Section>

            <Section title="Layout">
              <Field label="Density">
                <Segmented
                  label="Density"
                  value={density?.value ?? ""}
                  onChange={(value) => {
                    const preset = DENSITIES.find((d) => d.value === value);
                    if (preset) applyDensity(preset);
                  }}
                  options={DENSITIES.map(({ value, label }) => ({ value, label }))}
                />
              </Field>
              <Field label="Line height" value={type.lineHeight.toFixed(2)}>
                <Slider
                  label="Line height"
                  value={type.lineHeight}
                  min={1.2}
                  max={2.2}
                  step={0.01}
                  onChange={(lineHeight) => {
                    editType({ lineHeight });
                  }}
                />
              </Field>
              <Field label="Measure" value={`${Math.round(type.measure)} ch`}>
                <Slider
                  label="Line length"
                  value={type.measure}
                  min={40}
                  max={120}
                  step={1}
                  onChange={(measure) => {
                    editType({ measure });
                  }}
                />
              </Field>
              <Field label="Page margins" value={`${layout.pagePadding.toFixed(1)} rem`}>
                <Slider
                  label="Page margins"
                  value={layout.pagePadding}
                  min={0}
                  max={8}
                  step={0.5}
                  onChange={(pagePadding) => {
                    editLayout({ pagePadding });
                  }}
                />
              </Field>
              <Field label="Paragraphs">
                <Segmented<ThemeTypography["paragraphStyle"]>
                  label="Paragraph style"
                  value={type.paragraphStyle}
                  onChange={(paragraphStyle) => {
                    editType({ paragraphStyle });
                  }}
                  options={[
                    { value: "spaced", label: "Spaced", title: "A blank line between paragraphs" },
                    {
                      value: "indented",
                      label: "Indented",
                      title: "A first-line indent, as in a book",
                    },
                  ]}
                />
              </Field>
              {type.paragraphStyle === "spaced" ? (
                <Field label="Paragraph spacing" value={`${type.paragraphSpacing.toFixed(2)} em`}>
                  <Slider
                    label="Paragraph spacing"
                    value={type.paragraphSpacing}
                    min={0}
                    max={3}
                    step={0.05}
                    onChange={(paragraphSpacing) => {
                      editType({ paragraphSpacing });
                    }}
                  />
                </Field>
              ) : (
                // The indent is what separates one paragraph from the next, so a
                // blank line as well would say it twice. Saying so beats leaving
                // a slider that visibly does nothing.
                <p className="py-1.5 text-[11.5px] leading-snug text-ui-text-faint">
                  An indent separates the paragraphs, so there is no space between them to set.
                </p>
              )}
              <Field label="Letter spacing" value={`${type.letterSpacing.toFixed(3)} em`}>
                <Slider
                  label="Letter spacing"
                  value={type.letterSpacing}
                  min={-0.05}
                  max={0.15}
                  step={0.005}
                  onChange={(letterSpacing) => {
                    editType({ letterSpacing });
                  }}
                />
              </Field>
              <Row label="Justify text">
                <Switch
                  label="Justify text"
                  checked={type.justify}
                  onChange={(justify) => {
                    editType({ justify });
                  }}
                />
              </Row>
              <Row label="Hyphenate">
                <Switch
                  label="Hyphenate"
                  checked={type.hyphenate}
                  onChange={(hyphenate) => {
                    editType({ hyphenate });
                  }}
                />
              </Row>
              <Row label="Number headings">
                <Switch
                  label="Number headings"
                  checked={layout.numberHeadings}
                  onChange={(numberHeadings) => {
                    editLayout({ numberHeadings });
                  }}
                />
              </Row>
              <Field label="Link underlines">
                <Segmented<ThemeTypography["linkUnderline"]>
                  label="Link underlines"
                  value={type.linkUnderline}
                  onChange={(linkUnderline) => {
                    editType({ linkUnderline });
                  }}
                  options={[
                    { value: "always", label: "Always" },
                    { value: "hover", label: "On hover" },
                    { value: "never", label: "Never" },
                  ]}
                />
              </Field>
            </Section>

            <Section title="Tables">
              <Field label="Density">
                <Segmented<ThemeLayout["table"]["density"]>
                  label="Table density"
                  value={layout.table.density}
                  onChange={(density) => {
                    editTable({ density });
                  }}
                  options={[
                    { value: "comfortable", label: "Comfortable" },
                    { value: "compact", label: "Compact" },
                  ]}
                />
              </Field>
              <Field label="Rules">
                <Segmented<ThemeLayout["table"]["rules"]>
                  label="Table rules"
                  value={layout.table.rules}
                  onChange={(rules) => {
                    editTable({ rules });
                  }}
                  options={[
                    {
                      value: "hairline",
                      label: "Hairline",
                      title: "Rows only — the editorial default",
                    },
                    {
                      value: "grid",
                      label: "Grid",
                      title: "Vertical rules too, for wide data tables",
                    },
                  ]}
                />
              </Field>
              <Row label="Striped rows">
                <Switch
                  label="Striped rows"
                  checked={layout.table.zebra}
                  onChange={(zebra) => {
                    editTable({ zebra });
                  }}
                />
              </Row>
            </Section>

            <Section title="Code">
              <Row label="Line numbers">
                <Switch
                  label="Show line numbers"
                  checked={theme.code.lineNumbers}
                  onChange={(lineNumbers) => {
                    edit((current) => ({
                      ...current,
                      code: { ...current.code, lineNumbers },
                    }));
                  }}
                />
              </Row>
              <Row label="Wrap long lines">
                <Switch
                  label="Wrap long lines"
                  checked={theme.code.wrap}
                  onChange={(wrap) => {
                    edit((current) => ({
                      ...current,
                      code: { ...current.code, wrap },
                    }));
                  }}
                />
              </Row>
            </Section>

            <Section title="Colors">
              {COLOR_FIELDS.map(({ key, label }) => (
                <ColorSwatch
                  key={key}
                  label={label}
                  value={theme.colors[key]}
                  onChange={(value) => {
                    editColor(key, value);
                  }}
                />
              ))}
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
                  onClick={() => void importTheme(config, onUpdateConfig, setStatus)}
                />
              </div>
              {status && <p className="pt-2 text-[11.5px] text-ui-text-faint">{status}</p>}
            </Section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Swatch cards rather than a dropdown: a theme is a look, and a list of names
 *  makes the reader open each one to find out what it is. */
function ThemeGallery({ activeId, onPick }: { activeId: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 pt-1">
      {PRESETS.map((preset) => {
        const isActive = preset.id === activeId;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              onPick(preset.id);
            }}
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
    defaultPath: `${theme.id}.lindo-md-theme.json`,
    filters: [{ name: "lindo-md theme", extensions: ["json"] }],
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
    filters: [{ name: "lindo-md theme", extensions: ["json"] }],
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
