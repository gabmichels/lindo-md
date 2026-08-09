import * as RadixSelect from "@radix-ui/react-select";
import * as RadixSlider from "@radix-ui/react-slider";
import * as RadixSwitch from "@radix-ui/react-switch";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { toHex } from "@/lib/theme/color";
import { cn } from "@/lib/utils";

/**
 * Radix primitives restyled to the `--ui-*` tokens.
 *
 * Radix is here for behavior only — focus management, keyboard handling, ARIA,
 * dismissal. None of its default appearance survives: no stock radii, no
 * borders drawn out of habit, and depth from planes rather than outlines
 * (DESIGN.md).
 */

export function Field({
  label,
  value,
  children,
}: {
  label: string;
  /** The current value, shown right-aligned — a slider without a read-out is a
   *  control you cannot return to a previous setting. */
  value?: string;
  children: ReactNode;
}) {
  return (
    <div className="py-1.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-ui-text">{label}</span>
        {value !== undefined && (
          <span className="font-variant-numeric-tabular text-[11.5px] text-ui-text-faint tabular-nums">
            {value}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-ui-hairline px-4 py-3 first:border-t-0">
      <h3 className="rail-label mb-1">{title}</h3>
      {children}
    </section>
  );
}

/**
 * A collapsible run of `Section`s.
 *
 * The drawer was eight flat sections in one scroll, which worked until a theme
 * gained eleven component controls. Grouping is structure inside the panel that
 * already exists rather than a second surface — DESIGN.md's rule is that a visual
 * setting belongs in the drawer, and that does not stop being true when there are
 * more of them.
 *
 * `<details>` rather than state: it is disclosure, the browser already gives it
 * keyboard handling and the right ARIA, and the open/closed state is genuinely
 * ephemeral — nothing here is worth persisting to config.
 */
export function Group({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group border-t border-ui-hairline">
      <summary
        className={cn(
          "flex cursor-default list-none items-center justify-between px-4 py-2.5",
          "text-[12.5px] text-ui-text-muted transition-colors duration-[var(--ui-dur)]",
          "hover:text-ui-text-strong focus-visible:outline-none focus-visible:text-ui-text-strong",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {title}
        <ChevronDown
          size={13}
          strokeWidth={1.5}
          aria-hidden
          className="opacity-60 transition-transform duration-[var(--ui-dur)] group-open:rotate-180"
        />
      </summary>
      {/* The sections inside draw their own top hairline; the group's own rule
          would otherwise double up with the first one's. */}
      <div className="[&>section:first-child]:border-t-0">{children}</div>
    </details>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <RadixSlider.Root
      aria-label={label}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([next]) => {
        if (next !== undefined) onChange(next);
      }}
      className="relative flex h-4 w-full touch-none items-center select-none"
    >
      <RadixSlider.Track className="relative h-[3px] w-full grow rounded-full bg-ui-sunken">
        <RadixSlider.Range className="absolute h-full rounded-full bg-ui-ember-dim" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        className={cn(
          "block size-3.5 rounded-full bg-ui-text-strong",
          "transition-transform duration-[var(--ui-dur)] ease-[var(--ui-ease)]",
          "hover:scale-110 focus-visible:outline-2 focus-visible:outline-ui-ember",
        )}
      />
    </RadixSlider.Root>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <RadixSwitch.Root
      aria-label={label}
      checked={checked}
      onCheckedChange={onChange}
      className={cn(
        "relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-[var(--ui-dur)]",
        checked ? "bg-ui-ember-dim" : "bg-ui-sunken",
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          "block size-3.5 translate-x-[2px] rounded-full bg-ui-text-strong",
          "transition-transform duration-[var(--ui-dur)] ease-[var(--ui-ease)]",
          "data-[state=checked]:translate-x-[16px]",
        )}
      />
    </RadixSwitch.Root>
  );
}

/**
 * A short, closed set of choices, all visible at once.
 *
 * Preferred over a `Select` wherever there are two or three options and the
 * point is to compare them: the drawer writes through on every change, so a
 * setting you can reach in one click is a setting you can actually judge
 * against the document behind the panel.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            "flex-1 rounded-ui-md py-1.5 text-[12px]",
            "transition-colors duration-[var(--ui-dur)]",
            value === option.value
              ? "bg-ui-ember-wash text-ui-text-strong"
              : "bg-ui-plane-1 text-ui-text-muted hover:text-ui-text",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-[12.5px] text-ui-text">
      <span>{label}</span>
      {children}
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  /** Rendered in the option's own font, so a font picker shows the face. */
  fontFamily?: string;
  /** Heading this option sits under. Options are grouped in the order the
   *  headings first appear, so the caller controls the sequence by ordering the
   *  array rather than by passing a separate structure. */
  group?: string;
}

/** Groups in first-seen order, or a single unlabelled run if nobody set one. */
function grouped(options: SelectOption[]): { group?: string; options: SelectOption[] }[] {
  if (!options.some((option) => option.group)) return [{ options }];

  const order: string[] = [];
  const byGroup = new Map<string, SelectOption[]>();
  for (const option of options) {
    const key = option.group ?? "";
    if (!byGroup.has(key)) {
      order.push(key);
      byGroup.set(key, []);
    }
    byGroup.get(key)!.push(option);
  }
  return order.map((key) => ({ group: key || undefined, options: byGroup.get(key)! }));
}

export function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
}) {
  const current = options.find((option) => option.value === value);

  return (
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger
        aria-label={label}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-ui-md bg-ui-plane-1 px-2 py-1.5",
          "text-left text-[12.5px] text-ui-text transition-colors duration-[var(--ui-dur)]",
          "hover:bg-ui-plane-2",
        )}
      >
        <span
          className="truncate"
          style={current?.fontFamily ? { fontFamily: current.fontFamily } : undefined}
        >
          <RadixSelect.Value />
        </span>
        <ChevronDown size={13} strokeWidth={1.5} className="shrink-0 opacity-60" aria-hidden />
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden",
            "rounded-ui-lg bg-ui-plane-2 p-1 shadow-2xl",
          )}
        >
          {/* Past a dozen options the list scrolls, and a popper that scrolls
              without saying so reads as a list that simply ends. */}
          <RadixSelect.ScrollUpButton className="flex justify-center py-0.5 text-ui-text-faint">
            <ChevronDown size={12} strokeWidth={1.5} className="rotate-180" aria-hidden />
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport>
            {grouped(options).map(({ group, options: items }) => (
              <RadixSelect.Group key={group ?? "all"}>
                {group && (
                  <RadixSelect.Label className="rail-label px-2 pt-2 pb-1">
                    {group}
                  </RadixSelect.Label>
                )}
                {items.map((option) => (
                  <RadixSelect.Item
                    key={option.value}
                    value={option.value}
                    className={cn(
                      "flex cursor-default items-center justify-between gap-2 rounded-ui-sm px-2 py-1.5",
                      "text-[12.5px] text-ui-text outline-none",
                      "data-[highlighted]:bg-ui-ember-wash data-[highlighted]:text-ui-text-strong",
                    )}
                  >
                    <RadixSelect.ItemText>
                      {/* A face shown at row size is a name, not a specimen: 12.5px is
                          below where a serif's detail survives, which is the one thing
                          the reader is trying to judge. */}
                      <span
                        className={option.fontFamily ? "text-[15px]" : undefined}
                        style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}
                      >
                        {option.label}
                      </span>
                    </RadixSelect.ItemText>
                    <RadixSelect.ItemIndicator>
                      <Check size={13} strokeWidth={2} className="text-ui-ember" aria-hidden />
                    </RadixSelect.ItemIndicator>
                  </RadixSelect.Item>
                ))}
              </RadixSelect.Group>
            ))}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton className="flex justify-center py-0.5 text-ui-text-faint">
            <ChevronDown size={12} strokeWidth={1.5} aria-hidden />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

/** A native color input, restyled to a swatch. Native because the OS picker is
 *  better than anything worth writing here, and users arrive with a hex code. */
export function ColorSwatch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-[12px] text-ui-text-muted">
      <span className="truncate">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={toHex(value)}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className="size-5 cursor-pointer rounded-ui-sm border-0 bg-transparent p-0"
        />
      </span>
    </label>
  );
}
