# Design language

lindo-md is a reading instrument. Its interface is authored, not defaulted: Radix supplies
behavior (focus management, dismissal, ARIA) and every visual decision is ours. There is no stock
zinc palette, no framework radius scale, and no borders drawn out of habit.

## The one structural idea

**The tool and the paper are different materials, and the tool is made from the paper.**

A tool rail sits against the document canvas. It is not the same colour as the page and never is —
it is a step away from the page's own ground and much quieter, so the two read as a sheet lying on
a surface rather than as one continuous field. You always know which you are looking at.

This used to say the tool was *fixed*: an always-dark rail whatever the page did. That was
defensible — the tool is a constant object and the paper is the thing you retheme — and it was the
one decision every reader read as a bug. A black rail beside a bone-white page does not look like
two materials, it looks like an app that forgot half of itself. The mismatch is luminance, not hue:
nobody objects to a sepia page in a chrome-coloured window, they object to a *bright* page in a
*black* window.

So the relationship is now derived rather than fixed, which keeps what the old rule was for and
drops what it cost:

| Namespace | Owns | Written by | Onto |
| --- | --- | --- | --- |
| `--ui-*` | Rail, titlebar, notes panel, settings, dialogs, find bar | `lib/theme/chrome.ts` | `documentElement` |
| `--doc-*` | Everything inside the document canvas | `lib/theme/apply.ts` | the canvas |

Two elements, not one, and the split is not arbitrary. `--doc-*` belongs on the canvas because
custom properties inherit, so a themed card inside a themed page overrides cleanly. `--ui-*` belongs
on the root because chrome is spread across the whole window — including every dialog Radix portals
out to `<body>`, which is not inside the canvas and never will be.

**A chrome component must never read a `--doc-*` variable, and nothing inside the document canvas
may read a `--ui-*` variable.** That rule survived the change unaltered, and it is worth being clear
about why, because "the chrome is themed now" sounds like it should have repealed it. It never meant
"the chrome cannot change" — it meant **the chrome changes as one material, in one place**. A
component that reaches into the page's palette and picks a colour that suits it is how you get
fifteen presets with fourteen different-looking rails. `theme.test.ts` fails the build if the rule
is broken, reading `document.css` for a `--ui-*` read and every component for a `--doc-*` one. That
check was named here for a long time before it existed, which is how a context-menu swatch reading a
`--doc-*` token got as far as review.

Both sets have House Light defaults in `styles.css` so the first paint is right before React mounts.
The `--ui-*` half of those defaults is **generated, not chosen** — `chrome.test.ts` recomputes them
from House and fails if the file has drifted. A hand-copied default that the app overwrites a frame
later rots silently, because the only symptom is a flash nobody files a bug about.

### Why derived rather than authored per theme

The obvious alternative is a chrome palette in every preset. Fifteen presets in two appearances is
thirty hand-tuned palettes, each of which can be got wrong quietly, and it does nothing at all for a
theme a reader wrote — which is a file this code has never seen.

Deriving also makes the guarantees real rather than reviewed. Every rung of the text ramp is
*solved* for a contrast ratio against the surface it sits on rather than picked and eyeballed, so
"the chrome is legible" is a property of the construction. The bars are above WCAG AA throughout
because chrome text is small; `--ui-text-faint` is the deliberate exception at 3.2:1, since text
that is meant to recede stops receding at 4.5.

## Color

### The tool

Depth comes from stacked planes, never from outlines. The values are derived per theme (`chrome.ts`)
rather than written down here, so what follows is the *rule* each token obeys:

| Token | Rule | Used for |
| --- | --- | --- |
| `--ui-base` | The paper's ground, stepped toward mid-range and at 80% of its chroma | The rail itself |
| `--ui-plane-1` | One step toward the ink | Hover, inputs |
| `--ui-plane-2` | Two steps toward the ink | Popovers, active row |
| `--ui-sunken` | One step *away* from the ink | Wells and fields |
| `--ui-hairline` | The strong ink at 8% | Section separation |

Depth runs toward the ink and recession away from it, which is one rule that reads correctly in both
appearances. On a dark tool a hovered row lifts toward white and a well drops toward black; on a
light tool both invert, giving the grey toolbar with a white field sunk into it that every desktop
already uses. The step is larger on light grounds, because at the top of the lightness range a
difference that clearly separates two dark planes reads as a printing artefact instead.

Text runs `--ui-text` → `--ui-text-muted` → `--ui-text-faint`; anything that must shout uses
`--ui-text-strong`, sparingly. All four are solved against `--ui-base`, so the ramp keeps its
*relative* order on any ground rather than keeping fixed values that happen to work on one.

### The accent

One chrome accent, and it is now **the theme's own** — `--ui-accent`, taken from `colors.accent` and
moved only in lightness, enough to clear 3:1 on the rail. It marks the active file, focus rings, the
reading-progress hairline, and the ring around a window holding a droppable file — nothing else.
That last one is on the list because it *is* the second one: a focus ring drawn around the whole
window rather than around one control.

This was "Ember", a fixed warm amber-ochre, chosen so it could never read as part of a document
theme. That was the right accent for a tool that ignored the page and the wrong one for a tool
derived from it: an amber focus ring on a green Everforest rail is the same mismatch the black rail
was, one element smaller. An accent that is the page's accent means the tool and the page agree
about what "the highlighted thing" looks like.

`--ui-accent-ink` is what stays legible *on* the accent — the active find match paints text on it.
Derived rather than chosen, for the reason a mark's ink is: nothing stops a theme naming a colour
this build has never seen. `--ui-danger-ink` exists for the same reason, and is why the close
button's glyph is no longer a hardcoded `white`.

### Tab-group colours

The one other colour family in the chrome, and a deliberate exception to the rule above. Eight hues,
`--ui-group-clay` through `--ui-group-rose`, every one pinned to the same lightness and chroma:

```
oklch(0.62 0.09 H)   H ∈ 15, 75, 140, 195, 240, 280, 320, 355
```

They are an exception because they are **user data, not brand**: the reader picks them to tell their
own groups apart, so the app cannot be the one choosing. That is also why they are the one part of
the chrome that does **not** follow the theme — a hue that shifted when the reader changed theme
would stop being the label they picked. The constraints that keep them honest:

- Fixed `0.62 / 0.09`, and low enough in both that no group colour reads as louder than the
  active-file marker, whatever the reader picks. This used to be stated as "below Ember's
  `0.74 / 0.15`", which a derived accent can no longer promise arithmetically: a theme whose accent
  is a deep ink-teal sits below `0.62` in lightness. What holds instead is that the accent is
  guaranteed legible against the rail and the group colours are decoration on two surfaces — see the
  third bullet, which is what actually makes them safe.
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
| `heading.rule` | none, h1, h2, h1-h2 — GitHub's underline, the most recognisable tell there is |
| `heading.tracking` / `.leading` | numbers, previously constants in `document.css` |
| `heading.minor` | uppercase, small-caps, normal (h6) |
| `quote` | bar, card, hang, plain — **all tinted**; they differ in what joins the tint (a rule, a radius, a displacement, nothing) |
| `rule` | line, short, asterism, space |
| `code.block` / `.inline` | card / framed / flush, tint / outline / bare |
| `alert` | bar, card, minimal |
| `list` | default, dash, outdent |
| `tableHead` | uppercase, sentence |
| `image` | radius, frame |

Three rules hold it together:

1. **Enums and bounded numbers in the schema, never CSS.** This is a security property as much as
   a design one: the HTML exporter writes theme values into a raw-text `<style>`, and a closed set
   cannot carry an escape. It is why `isSafeCssValue` has nothing to do here.
2. **Every choice resolves to `--doc-*` tokens** in `componentTokens`, and a variant states every
   token in its group — including the ones it is turning *off*.
3. **Every default reproduces what the app drew before the group existed**, so a theme file
   exported by an older build imports and looks identical rather than merely parsing.

Rule 2 is the one that is easy to get wrong, and it was got wrong first. The obvious design is a
`data-*` attribute per choice and a `[data-quote="hang"] .doc blockquote` rule per variant — it
reads better, and it keeps `document.css` the only place that knows what a hanging quotation looks
like. It does not work here. **`applyTheme` writes onto the document canvas, not onto
`documentElement`**: `useTheme` passes the canvas, the drawer's previews pass a card, the specimen
passes twenty of them. With House's defaults on `<html>` for the first paint, two ancestors of the
same `.doc` carried the attributes, both selectors matched at identical specificity, and CSS breaks
that tie **by source order, not by proximity**. The variants did not override each other — their
properties unioned, and every non-House theme drew its own furniture on top of House's.

Custom properties inherit, so the nearest themed ancestor wins, which is what "this element is
themed" should mean. A theme inside a theme now works by construction rather than by everyone
remembering it must not happen. The price is the verbosity in rule 2, and it is paid in
`apply.ts` rather than in the stylesheet.

Two tests hold the parts a schema cannot see: no two presets may share a body face, size and
measure, and every preset must write the same *set* of tokens as House — a variant that only sets
the properties it turns on would leave an outer theme's showing through.

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
- **Focus is marked in the accent, and has to be.** With two documents on screen, the outline, the find
  bar and the paging keys act on the focused one — so which pane that is cannot be invisible, or
  `Ctrl+F` looks like it is choosing a pane at random. It is an inset underline on the pane's
  header rather than a ring around the whole pane, which would compete with the drop ring.

The pane is **read-only**, and says so with the same lock badge the toolbar uses for a file that
cannot be edited. Same component, different reason: there the file cannot be written, here this view
is not where it is written.

**Dragging a tab into the right half opens it there**, and the drop target is drawn as the *region*
it would occupy — an accent wash over exactly that half, with an accent edge down its seam — rather
than as a ring around it. The region is the message: the reader is being told the document will fill
precisely this. It is the same accent that marks the active file and the droppable window, used for
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

- 4px base grid. Rail 264px and notes panel 248px, both resizable 200–420 by a drag handle on the
  seam; the rail collapses to 52px, where there is nothing left to resize and the handle goes with
  it. Row height 30px, rail padding 10px. The handle draws nothing at rest — the seam is already
  there — and an accent line under the pointer, the keyboard, or a drag. It carries no layout width
  for the same reason, and hangs a 9px hit area off itself, because the seam sits between two
  scrollers and an under-shoot otherwise lands on a scrollbar.
- **The rail's two sections size themselves from their content, and each states a floor.** The
  tree and the outline shrink in proportion when the rail cannot hold both, which is right until one
  is much larger than the other and wipes the smaller out — so each keeps `min(its own content, four
  rows)`. The floor is a measurement rather than a percentage on purpose: the outline used to carry a
  flat `max-h-[60%]`, which is a floor for the tree written as a ceiling on the outline, and a
  ceiling cannot tell whether the tree needs the room. It capped the outline at two thirds of the
  rail with the tree collapsed, with the tree empty, and with a three-file tree that wanted 90px of
  it.
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
3. Focus is always an accent ring, never a browser outline, and never removed.
4. Every icon-only control carries an `aria-label`.
5. Document styles are scoped under `.doc` and are the only place `--doc-*` may be read.
6. The window must always have somewhere to be dragged by. The tab strip reserves 56px of
   `drag-region` at its end whatever happens, and the rail reserves the whole titlebar band — on a
   frameless window a full strip with no drag region is a window that cannot be moved.
7. Gaps between two `no-drag` elements in the titlebar are drawn as padding, never as margin. A
   margin leaves a live drag sliver, and a click landing in it moves the window.

## Keeping it honest

`src/Specimen.tsx` (open the app with `?specimen`) renders every chrome state — rail, tree, outline,
tab strip, settings drawer, find bar, dialogs, empty state, all window-control states — beside one
card per preset. Review it at 1024 / 1440 / 1920 in both appearances before calling any visual work
done.

Two things about those cards, both learned the hard way in the same review:

- **The card body is a real `.doc`.** It used to be hand-built markup — a `border-l-2` blockquote,
  a rounded code chip — which was an honest picture of a theme while a theme was a palette. Once a
  theme chose whether a quotation has a bar at all, hand-built markup showed twenty presets looking
  identical and hid exactly what the reviewer was there to judge. Anything `document.css` draws,
  `document.css` draws here.
- **The drawer is actually mounted.** This paragraph listed it for a long time while the specimen
  did not render it, so the surface with the most controls in the app was the one that could not be
  looked at without building for Tauri.

A specimen that is out of date with what it claims to show is worse than no specimen, because the
review passes.

The tab strips in the specimen are live: they reorder, group and collapse, so the squeeze and the
drag can be judged by using them rather than by looking at a still. They are also the only place the
strip can be driven outside a Tauri host, which is why `TabStrip` contains no Tauri call.
