import { useEffect, useRef, useState } from "react";

import { DropOverlay } from "@/components/DropOverlay";
import { FormatMenu } from "@/components/FormatMenu";
import { Rail } from "@/components/Rail";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { TabStrip } from "@/components/TabStrip";
import { useUpdater } from "@/hooks/useUpdater";
import {
  EMPTY_SESSION,
  activateTab,
  closeTab,
  moveGroup,
  moveTab,
  normalize,
  setGroupCollapsed,
  type Session,
} from "@/lib/tabs/model";
import { applyTheme } from "@/lib/theme/apply";
import { PRESETS } from "@/lib/theme/presets";
import type { Appearance } from "@/lib/theme/schema";
import type { AppConfig, TreeNode } from "@/lib/ipc";

/**
 * The design specimen — open the app with `?specimen`.
 *
 * Every chrome state on one page, next to a paragraph of each theme's paper, so
 * a visual change can be judged against DESIGN.md rather than against memory.
 * Reviewed at 1024 / 1440 / 1920 in both appearances before any visual work is
 * called done.
 *
 * It runs outside a Tauri host too — `pnpm dev` and a browser is enough — which
 * is the point: no file has to be opened to look at the design.
 */

const TREE: TreeNode[] = [
  {
    name: "guides",
    path: "/docs/guides",
    isDir: true,
    children: [
      {
        name: "getting-started.md",
        path: "/docs/guides/getting-started.md",
        isDir: false,
        children: [],
      },
      {
        name: "theming.md",
        path: "/docs/guides/theming.md",
        isDir: false,
        children: [],
      },
    ],
  },
  { name: "README.md", path: "/docs/README.md", isDir: false, children: [] },
  { name: "CHANGELOG.md", path: "/docs/CHANGELOG.md", isDir: false, children: [] },
];

const TOC = [
  { level: 1, text: "Getting Started", id: "getting-started" },
  { level: 2, text: "Installing", id: "installing" },
  { level: 3, text: "From source", id: "from-source" },
  { level: 2, text: "Configuration", id: "configuration" },
  { level: 2, text: "Troubleshooting", id: "troubleshooting" },
];

/** The settings dialog reads its own state over IPC. Outside a Tauri host those
 *  calls reject, which is the case the component already handles by hiding the
 *  rows it has no answer for — so the specimen shows the dialog's chrome without
 *  needing a running backend. */
const SPECIMEN_CONFIG: AppConfig = {
  version: 1,
  themeId: "house",
  appearance: "system",
  customThemes: [],
  railWidth: 264,
  railCollapsed: false,
  railTreeCollapsed: false,
  recentFiles: [],
  lastFolder: null,
  blockRemoteImages: true,
  respectGitignore: true,
  showHiddenFiles: false,
  reopenLastDocument: true,
  checkForUpdates: true,
  zoom: 1,
  smartPunctuation: false,
  contentWidth: "standard",
  session: EMPTY_SESSION,
};

export default function Specimen() {
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [collapsed, setCollapsed] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Disabled on purpose: the specimen runs in a browser, where a launch check
  // could only fail, and the state worth reviewing here is the resting one.
  const updater = useUpdater(false);

  return (
    <div className="flex h-full">
      <Rail
        collapsed={collapsed}
        onToggleCollapsed={() => {
          setCollapsed((c) => !c);
        }}
        folder="/docs"
        onPickFolder={() => undefined}
        tree={TREE}
        activePath="/docs/guides/theming.md"
        openPaths={new Set(["/docs/README.md", "/docs/guides/theming.md"])}
        onOpen={() => undefined}
        treeCollapsed={treeCollapsed}
        onToggleTreeCollapsed={() => {
          setTreeCollapsed((c) => !c);
        }}
        toc={TOC}
        activeHeadingId="installing"
        progress={0.42}
        onJumpTo={() => undefined}
        onOpenAppearance={() => {
          setDrawerOpen(true);
        }}
        onOpenSettings={() => {
          setSettingsOpen(true);
        }}
        onExport={() => undefined}
        onOpenAbout={() => undefined}
      />

      <main className="canvas-edge min-w-0 flex-1 overflow-y-auto bg-ui-sunken p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-[15px] text-ui-text-strong">Design specimen</h1>
            <p className="text-[12px] text-ui-text-muted">
              The rail on the left is the real component. Each card below is one preset's paper,
              rendered with its own tokens.
            </p>
          </div>
          <div className="flex gap-1">
            {(["light", "dark"] as Appearance[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setAppearance(mode);
                }}
                className={`rounded-ui-md px-3 py-1.5 text-[12px] capitalize ${
                  appearance === mode
                    ? "bg-ui-ember-wash text-ui-text-strong"
                    : "bg-ui-plane-1 text-ui-text-muted"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </header>

        <TabStripStates />

        <FormatMenuState />

        <DropOverlayState />

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
          {PRESETS.map((preset) => (
            <PaperCard
              key={preset.id}
              name={preset.name}
              note={preset.note}
              theme={preset[appearance]}
            />
          ))}
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={SPECIMEN_CONFIG}
        onUpdateConfig={() => undefined}
        onOpenAppearance={() => {
          setDrawerOpen(true);
        }}
        updater={updater}
      />

      {/* DESIGN.md has always listed the appearance drawer among the states this
          page renders, and it was not among them — so the one surface with the
          most controls in the app was the one nobody could review without running
          Tauri. Its edits are inert here: `onUpdateConfig` is a no-op, so the
          panel shows House's settings and every control is in its resting state,
          which is what a specimen is for. */}
      <SettingsDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        config={SPECIMEN_CONFIG}
        theme={PRESETS[0]![appearance]}
        onUpdateConfig={() => undefined}
      />
    </div>
  );
}

/**
 * The formatting menu, over paper rather than over the rail.
 *
 * That is the state worth looking at: it is chrome that opens on top of the
 * document, so the question it has to answer is whether it still reads as the
 * tool and not as part of the page. Right-click the panel to open it. The
 * disabled column is what a reader sees with no selection, or one spanning two
 * blocks.
 */
/**
 * The drop target, which is otherwise only reachable by holding a real file over
 * a real window — the one chrome state that cannot be photographed at leisure.
 *
 * It covers the whole viewport, specimen included, because that is what it does
 * in the app. Nothing under it stops working: the overlay never takes pointer
 * events, so the toggle below it is still clickable while it is up.
 */
function DropOverlayState() {
  const [active, setActive] = useState(false);

  return (
    <section className="mb-4">
      <h2 className="mb-2 text-[10.5px] uppercase tracking-[0.08em] text-ui-text-faint">
        Drop target
      </h2>
      <button
        type="button"
        onClick={() => {
          setActive((current) => !current);
        }}
        className="rounded-ui-md bg-ui-plane-1 px-3 py-1.5 text-[12px] text-ui-text"
      >
        {active ? "Hide" : "Show"} the drop overlay
      </button>
      <DropOverlay active={active} />
    </section>
  );
}

function FormatMenuState() {
  const [command, setCommand] = useState<string | null>(null);

  return (
    <section className="mb-4">
      <h2 className="mb-2 text-[10.5px] uppercase tracking-[0.08em] text-ui-text-faint">
        Formatting menu
      </h2>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
        {[true, false].map((canFormat) => (
          <FormatMenu
            key={String(canFormat)}
            canFormat={canFormat}
            onFormat={(next) => {
              setCommand(next);
            }}
            onCopy={() => {
              setCommand("copy");
            }}
          >
            <div className="rounded-ui-lg bg-doc-bg p-4 font-serif text-[15px] text-doc-text">
              {canFormat ? "A selection inside one block." : "No usable selection."}
            </div>
          </FormatMenu>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ui-text-faint">last command: {command ?? "—"}</p>
    </section>
  );
}

/**
 * Every state the tab strip can be in, at the widths that change its behaviour.
 *
 * The point is the squeeze: the same component at 1200px and at 520px has to
 * stay legible, keep a drag region, and hand over to the overflow menu at the
 * floor rather than shrinking into nothing.
 */
function TabStripStates() {
  const [sessions, setSessions] = useState(() => SPECIMEN_SESSIONS);

  /** Applies a change to one row's session and leaves the others alone. */
  const edit = (index: number, change: (session: Session) => Session) => {
    setSessions((current) =>
      current.map((entry, position) =>
        position === index ? { ...entry, session: change(entry.session) } : entry,
      ),
    );
  };

  return (
    <section className="mb-8">
      <p className="rail-label mb-2">Tab strip</p>
      <div className="flex flex-col gap-3">
        {sessions.map((entry, index) => (
          <div key={entry.label}>
            <p className="mb-1 text-[11px] text-ui-text-faint">
              {entry.label} · {entry.width}px
            </p>
            <div
              className="flex h-[var(--ui-titlebar-h)] items-stretch overflow-hidden rounded-ui-md bg-ui-base"
              style={{ width: entry.width }}
            >
              <TabStrip
                session={entry.session}
                onActivate={(id) => {
                  edit(index, (s) => activateTab(s, id));
                }}
                onClose={(id) => {
                  edit(index, (s) => closeTab(s, id));
                }}
                onNewTab={() => undefined}
                onToggleGroup={(groupId) => {
                  edit(index, (s) => {
                    const group = s.groups.find((g) => g.id === groupId);
                    return group ? setGroupCollapsed(s, groupId, !group.collapsed) : s;
                  });
                }}
                onReorder={(id, seam, intent) => {
                  edit(index, (s) => moveTab(s, id, seam, intent));
                }}
                onReorderGroup={(groupId, seam) => {
                  edit(index, (s) => moveGroup(s, groupId, seam));
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function tabSession(
  names: string[],
  options: { group?: [number, number]; collapsed?: boolean; preview?: string } = {},
): Session {
  const [from, to] = options.group ?? [-1, -1];

  return normalize({
    tabs: names.map((name, index) => ({
      id: name,
      path: `/docs/${name}.md`,
      groupId: index >= from && index <= to ? "g" : null,
      preview: name === options.preview,
      openerId: null,
    })),
    groups:
      from < 0
        ? []
        : [
            {
              id: "g",
              name: "Specs",
              color: "teal" as const,
              collapsed: options.collapsed ?? false,
            },
          ],
    activeTabId: names[0] ?? null,
    comparePath: null,
  });
}

const SPECIMEN_SESSIONS = [
  { label: "One tab", width: 1200, session: tabSession(["README"]) },
  {
    label: "A few, capped at their maximum",
    width: 1200,
    session: tabSession(["README", "CHANGELOG", "theming", "shortcuts"]),
  },
  {
    label: "Preview tab, italic — replaced by the next single click",
    width: 1200,
    session: tabSession(["README", "theming"], { preview: "theming" }),
  },
  {
    label: "A group, expanded",
    width: 1200,
    session: tabSession(["inbox", "api", "db", "todo"], { group: [1, 2] }),
  },
  {
    label: "The same group, collapsed to its pill",
    width: 1200,
    session: tabSession(["inbox", "api", "db", "todo"], {
      group: [1, 2],
      collapsed: true,
    }),
  },
  {
    label: "Squeezed",
    width: 760,
    session: tabSession([
      "README",
      "CHANGELOG",
      "theming",
      "shortcuts",
      "install",
      "faq",
      "api",
      "db",
      "roadmap",
    ]),
  },
  {
    label: "At the floor — the strip scrolls and the overflow menu appears",
    width: 520,
    session: tabSession([
      "README",
      "CHANGELOG",
      "theming",
      "shortcuts",
      "install",
      "faq",
      "api",
      "db",
      "roadmap",
      "changelog-2",
      "notes",
      "scratch",
    ]),
  },
];

/**
 * A theme applied to a real element, so what is on screen is what `applyTheme`
 * produces rather than an approximation of it.
 *
 * The body below is a real `.doc`, and that matters more than it used to. This
 * card was hand-built markup — a `border-l-2` blockquote, a rounded code chip —
 * which was an honest picture of a theme back when a theme was a palette. Now
 * that a theme also chooses whether a quotation has a bar at all, hand-built
 * markup shows every preset looking the same and hides exactly the differences
 * the reviewer is here to judge. Anything drawn from `document.css` is drawn by
 * `document.css`.
 */
function PaperCard({
  name,
  note,
  theme,
}: {
  name: string;
  note: string;
  theme: (typeof PRESETS)[number]["light"];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) applyTheme(theme, ref.current);
  }, [theme]);

  return (
    <div ref={ref} className="overflow-hidden rounded-ui-lg">
      <div className="bg-doc-bg p-5">
        <p className="rail-label mb-2">{name}</p>
        {/* `--doc-page` and the gutters come from the card, not the theme: these
            sit three to a row and a 66ch measure would overflow every one of
            them. Everything else is the theme's. */}
        <div
          className="doc"
          style={{ maxWidth: "none", padding: 0, fontSize: "calc(var(--doc-size) * 0.8)" }}
        >
          <h2>Getting Started</h2>
          <p>
            Ordinary paragraph text with a <a href="#specimen">link</a>, some{" "}
            <code>inline code</code>, an <em>italic</em>, and enough words to judge the colour of
            the ink.
          </p>
          <blockquote>
            <p>{note}</p>
          </blockquote>
          <hr />
          <ul>
            <li>A list marker, whichever kind the theme asks for</li>
            <li>And a second line under it</li>
          </ul>
          <pre className="code-block">
            <code>{"const theme = resolveTheme(id, appearance);"}</code>
          </pre>
          <table>
            <thead>
              <tr>
                <th>Header</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Measure</td>
                <td>{theme.typography.measure}ch</td>
              </tr>
              <tr>
                <td>Body</td>
                <td>{theme.typography.baseSize}px</td>
              </tr>
            </tbody>
          </table>
          {/* comrak's own markup for a `> [!NOTE]`, so the alert style the theme
              chose is what gets drawn. */}
          <div className="markdown-alert markdown-alert-note">
            <p className="markdown-alert-title">Note</p>
            <p>How this theme draws a callout.</p>
          </div>
          <h6>A minor heading</h6>
        </div>
        {/* The five alert hues as bare swatches, which is a check on the palette
            rather than on the component — they have to stay apart from each other
            whatever shape the callout above is drawn in. */}
        <div className="mt-3 flex gap-1">
          {(["note", "tip", "important", "warning", "caution"] as const).map((kind) => (
            <span
              key={kind}
              className="h-1.5 flex-1 rounded-full"
              style={{ background: `var(--doc-alert-${kind})` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
