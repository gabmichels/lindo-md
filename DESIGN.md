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
the reading-progress hairline, and the ring around a window holding a droppable file — nothing else.
That last one is on the list because it *is* the second one: a focus ring drawn around the whole
window rather than around one control. It
is warm on purpose, so it never reads as "part of" a document theme, and it is not the blue-violet
every desktop app defaults to.

### Tab-group colours

The one other colour family in the chrome, and a deliberate exception to the rule above. Eight hues,
`--ui-group-clay` through `--ui-group-rose`, every one pinned to the same lightness and chroma:

```
oklch(0.62 0.09 H)   H ∈ 15, 75, 140, 195, 240, 280, 320, 355
```

They are an exception because they are **user data, not brand**: the reader picks them to tell their
own groups apart, so the app cannot be the one choosing. The constraints that keep them honest:

- Fixed `0.62 / 0.09` — below Ember's `0.74 / 0.15` in both. No group colour can out-shout the
  active-file marker, whatever the reader picks.
- They may tint exactly two things: a group's pill, and the band drawn behind that group's run of
  tabs. Never a tab body, never text, never an icon.
- Membership is legible without them — the band's shape says which tabs belong together, so the
  colour is a label, not the signal. It has to survive being invisible to a reader who cannot
  distinguish two of the hues.

### The paper

Every `--doc-*` value comes from the active theme. The default is **House**, our own:

- Ground "Bone" `oklch(0.985 0.004 85)` — paper white with a warm cast, not `#fff`
- Ink `oklch(0.28 0.010 60)` — a warm near-black, never `#000`
- Links deep ink-teal `oklch(0.48 0.09 200)`, underlined at `0.08em` offset. Never color alone.

## Type

The tool speaks in small sans; the document speaks in whatever its theme says. That contrast *is*
the design.

**Tool** — Inter Tight. 13px rows, 12px secondary, 10.5px uppercase section labels at `+0.08em`
tracking, tabular numerals everywhere a number can change.

**House document** — Source Serif 4 body at 19.5px / 1.62 / 66ch measure, Inter Tight semibold
headings at `-0.02em`. Modular scale **1.22** — tighter than the usual 1.25, because a document
viewer shows h1–h4 on one screen more often than a web page does. Heading margins follow an optical
rhythm (space above a heading always exceeds space below it), not a uniform multiple.

**Twenty-six bundled families**, generated into `src/fonts.css` by `scripts/fonts.mjs` — run
`pnpm fonts` after editing its manifest. Three rules that file exists to enforce:

- **Latin and latin-ext only.** Fontsource's package roots declare every subset Google ships;
  Vite bundles every one of them into the installer whether or not the app can render the script.
- **Italics are drawn, not slanted.** The package roots are upright-only, so until this existed
  every `<em>` and every blockquote was a synthesised oblique.
- **Take the `opsz` axis where a family has one.** It lives in the package's `opsz.css`, and the
  browser applies it with no CSS asking — `font-optical-sizing: auto` is the initial value.

The picker's list is generated from the same manifest (`src/lib/theme/fonts.ts`), and presets name
faces through `face()`, which throws at module load. A family cannot be bundled without being
offered, offered without being bundled, or named by a preset without existing.

## The page

`--doc-page` is how much of the window the document may occupy: the theme's measure at **Standard**,
one and a half measures at **Wide**, the whole window at **Full**. `.doc` is the page, and everything
inside follows it — a wide page means wide tables *and* wide prose. A document whose text stayed
narrow while its tables grew reads as two pages pasted together, so the measure sets the *default*
width rather than capping the text forever.

Content width is a **view** setting, stored in config beside zoom, never in a theme. A theme is a
file people share; it must not carry someone else's window.

## A theme is a voice, not a palette

This used to say the opposite. Layout was one shared object across all presets, on the reasoning
that a palette has no opinion about whether a table has vertical rules — which is true of a palette
and false of a theme. The result was measurable: fifteen presets, four typography sets, eleven of
them identical, so the whole difference between Nord and Everforest was hue.

A theme now also owns `components` — the page's furniture:

| Field | Choices |
| --- | --- |
| `heading.rule` | none, h1, h2, h1-h2 |
| `heading.tracking` / `.leading` | numbers, previously constants in `document.css` |
| `heading.minor` | uppercase, small-caps, normal (h6) |
| `quote` | bar, hang, card, plain |
| `rule` | line, short, asterism, space |
| `code.block` / `.inline` | card / framed / flush, tint / outline / bare |
| `alert` | bar, card, minimal |
| `list` | default, dash, outdent |
| `tableHead` | uppercase, sentence |
| `image` | radius, frame |

Three rules hold it together:

1. **Enums and bounded numbers, never CSS.** This is a security property as much as a design one:
   the HTML exporter writes theme values into a raw-text `<style>`, and a closed set cannot carry
   an escape. It is why `isSafeCssValue` has nothing to do here.
2. **Enums become `data-*` attributes on the document root; numbers become `--doc-*` tokens.** A
   rule and a value are different things — `quote: "hang"` selects a different set of rules rather
   than setting a property, and `document.css` stays the one place that knows what a hanging
   quotation looks like.
3. **Every default reproduces what the app drew before the group existed**, so a theme file
   exported by an older build imports and looks identical rather than merely parsing.

The attributes are also stamped on `<html>` in `index.html`. That is not decoration: a missing
token falls back to the House value in `styles.css`, but a missing *attribute* matches no rule at
all, so the first paint before React mounts would draw a quotation with no mark. `theme.test.ts`
fails if `index.html` and `componentAttributes` drift, and a separate test fails if any two presets
share a body face, size and measure — the regression this whole group exists to prevent is one no
schema can notice.

`numberHeadings` is deliberately **not** part of a preset's identity. It changes what the document
says rather than how it looks, and a theme deciding your spec is numbered is a theme editing your
content.

One thing to know before editing `document.css`: block rules use `margin-block`, not the
`margin: x 0` shorthand. The shorthand also resets the inline margins, which is a side effect no
rule here should have to reason about.

## The comparison pane

A second document beside the deck, at a fixed half of the canvas each. Three visual decisions, all
of them consequences of the rules above rather than new ones:

- **The seam is `compare-edge`, identical to `canvas-edge`.** Two panes of the same paper under the
  same theme, with nothing between them, read as one document with an inexplicable gutter down the
  middle. The hairline plus inward shadow is what says "a second sheet", and like the rail's edge it
  is drawn from `--ui-*` so it stays legible whether the paper is bone white or near-black.
- **The pane's header is tool, not paper.** It sits inside `<main>`, as the titlebar and toolbar
  already do, and reads `--ui-*` only. The rule that nothing may read `--ui-*` inside the document
  canvas is about what is inside `.doc-scroller`, not about everything under `<main>`.
- **Focus is marked in Ember, and has to be.** With two documents on screen, the outline, the find
  bar and the paging keys act on the focused one — so which pane that is cannot be invisible, or
  `Ctrl+F` looks like it is choosing a pane at random. It is an inset underline on the pane's
  header rather than a ring around the whole pane, which would compete with the drop ring.

The pane is **read-only**, and says so with the same lock badge the toolbar uses for a file that
cannot be edited. Same component, different reason: there the file cannot be written, here this view
is not where it is written.

**Dragging a tab into the right half opens it there**, and the drop target is drawn as the *region*
it would occupy — an Ember wash over exactly that half, with an Ember edge down its seam — rather
than as a ring around it. The region is the message: the reader is being told the document will fill
precisely this. It is the same Ember that marks the active file and the droppable window, used for
the same thing it is always used for.

## Two settings surfaces, on purpose

The **appearance drawer** is non-modal, has no scrim, and writes through on every change, because
the document behind it is the preview — a scrim would mean judging a theme through a grey filter,
and an Apply button would mean judging it from memory.

The **settings dialog** is an ordinary centred modal with tabs. Nothing in it has a preview: no one
needs to watch a paragraph while deciding whether the rail shows dotfiles.

That is the whole rule. A visual setting belongs in the drawer; anything else belongs in the dialog.
Merging them would give half the controls a shape that only the other half earns.

The drawer's sections are grouped under collapsible headings — Page, Type, Page furniture, Colors —
with the theme gallery and appearance above them and the theme file below. Eight flat sections in
one scroll worked until a theme could restyle its own furniture; the grouping is structure inside
the panel that already exists, not a third surface. Page and Type open by default because they are
what a reader came to adjust. `<details>`, not state: the browser brings the keyboard handling and
the ARIA, and nothing here is worth writing to config.

`Ctrl / ⌘ + ,` opens the dialog — the conventional meaning — and `Ctrl / ⌘ + Shift + ,` the drawer.

## Geometry and motion

- 4px base grid. Rail 264px, resizable 200–420, collapses to 52px. Row height 30px, rail padding 10px.
- Chrome is two rows: a 38px titlebar holding the tabs and the window controls, and a 34px toolbar
  under it. Tabs are 28px tall, 76–208px wide, and share the strip evenly — widening as tabs close,
  squeezing as they open, then scrolling once they hit the floor.
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
6. The window must always have somewhere to be dragged by. The tab strip reserves 56px of
   `drag-region` at its end whatever happens, and the rail reserves the whole titlebar band — on a
   frameless window a full strip with no drag region is a window that cannot be moved.
7. Gaps between two `no-drag` elements in the titlebar are drawn as padding, never as margin. A
   margin leaves a live drag sliver, and a click landing in it moves the window.

## Keeping it honest

`src/Specimen.tsx` (open the app with `?specimen`) renders every chrome state — rail, tree, outline,
tab strip, settings drawer, find bar, dialogs, empty state, all window-control states — beside the
kitchen-sink document. Review it at 1024 / 1440 / 1920 in both appearances before calling any visual
work done.

The tab strips in the specimen are live: they reorder, group and collapse, so the squeeze and the
drag can be judged by using them rather than by looking at a still. They are also the only place the
strip can be driven outside a Tauri host, which is why `TabStrip` contains no Tauri call.
