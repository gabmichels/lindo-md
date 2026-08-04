# Design language

lindo-md is a reading instrument. Its interface is authored, not defaulted: Radix supplies
behavior (focus management, dismissal, ARIA) and every visual decision is ours. There is no stock
zinc palette, no framework radius scale, and no borders drawn out of habit.

## The one structural idea

**The tool and the paper are different materials.**

A slim, always-dark tool rail sits against a bright document canvas. The document's theme changes
constantly — that is the point of the app — while the tool stays exactly the same object. You always
know which surface you are looking at.

This is enforced, not merely intended, by two token namespaces:

| Namespace | Owns | Changes when |
| --- | --- | --- |
| `--ui-*` | Rail, titlebar, settings, dialogs, find bar | Never |
| `--doc-*` | Everything inside the document canvas | Every theme switch |

**A chrome component must never read a `--doc-*` variable, and nothing inside the document canvas
may read a `--ui-*` variable.** The single exception is the reading-progress hairline, which is
Ember by design. `src/lib/theme/apply.test.ts` fails the build if the rule is broken.

`--ui-*` lives in `src/styles.css` and is static. `--doc-*` is written at runtime by
`src/lib/theme/apply.ts`; the House Light values are duplicated as defaults in `styles.css` so the
first paint is already correct before React mounts.

## Color

### The tool

Not black, not zinc — a cool deep neutral. Depth comes from three stacked planes, never from
outlines:

| Token | Value | Used for |
| --- | --- | --- |
| `--ui-base` | `oklch(0.19 0.012 265)` | The rail itself |
| `--ui-plane-1` | `oklch(0.225 0.012 265)` | Hover, inputs, sunken wells |
| `--ui-plane-2` | `oklch(0.26 0.013 265)` | Popovers, active row |
| `--ui-hairline` | 8% white | Section separation |

Text runs `--ui-text` → `--ui-text-muted` → `--ui-text-faint`; anything that must shout uses
`--ui-text-strong`, sparingly.

### Ember

One chrome accent: `oklch(0.74 0.15 62)`, a warm amber-ochre. It marks the active file, focus rings,
and the reading-progress hairline — nothing else. It is warm on purpose, so it never reads as
"part of" a document theme, and it is not the blue-violet every desktop app defaults to.

### The paper

Every `--doc-*` value comes from the active theme. The default is **House**, our own:

- Ground "Bone" `oklch(0.985 0.004 85)` — paper white with a warm cast, not `#fff`
- Ink `oklch(0.28 0.010 60)` — a warm near-black, never `#000`
- Links deep ink-teal `oklch(0.48 0.09 200)`, underlined at `0.08em` offset. Never color alone.

## Type

The tool speaks in small sans; the document speaks in serif. That contrast *is* the design.

**Tool** — Inter Tight. 13px rows, 12px secondary, 10.5px uppercase section labels at `+0.08em`
tracking, tabular numerals everywhere a number can change.

**House document** — Source Serif 4 body at 19.5px / 1.62 / 66ch measure, Inter Tight semibold
headings at `-0.02em`. Modular scale **1.22** — tighter than the usual 1.25, because a document
viewer shows h1–h4 on one screen more often than a web page does. Heading margins follow an optical
rhythm (space above a heading always exceeds space below it), not a uniform multiple.

## Geometry and motion

- 4px base grid. Rail 264px, resizable 200–420, collapses to 52px. Row height 30px, rail padding 10px.
- Radius scale **4 / 7 / 11**. Rail items are 7. Chosen, not inherited.
- Icons: lucide at 15px, 1.5 stroke, optically centered in a 20px box.
- Motion: 140ms `cubic-bezier(.2,.7,.2,1)` for state, 220ms for panels. Nothing animates position and
  opacity at different speeds. All of it is disabled under `prefers-reduced-motion`.

## Rules that keep it consistent

1. No color literal in a component — only `--ui-*` / `--doc-*` tokens or their Tailwind aliases.
2. No `border` in the chrome to create separation. Use a plane or a hairline.
3. Focus is always an Ember ring, never a browser outline, and never removed.
4. Every icon-only control carries an `aria-label`.
5. Document styles are scoped under `.doc` and are the only place `--doc-*` may be read.

## Keeping it honest

`src/Specimen.tsx` (open the app with `?specimen`) renders every chrome state — rail, tree, outline,
settings drawer, find bar, dialogs, empty state, all window-control states — beside the kitchen-sink
document. Review it at 1024 / 1440 / 1920 in both appearances before calling any visual work done.
