import { useEffect, useRef, useState } from "react";

import { Rail } from "@/components/Rail";
import { applyTheme } from "@/lib/theme/apply";
import { PRESETS } from "@/lib/theme/presets";
import type { Appearance } from "@/lib/theme/schema";
import type { TreeNode } from "@/lib/ipc";

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

export default function Specimen() {
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-full">
      <Rail
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        folder="/docs"
        onPickFolder={() => undefined}
        tree={TREE}
        activePath="/docs/guides/theming.md"
        onOpen={() => undefined}
        toc={TOC}
        activeHeadingId="installing"
        progress={0.42}
        onJumpTo={() => undefined}
        onOpenSettings={() => undefined}
        onExport={() => undefined}
        onOpenAbout={() => undefined}
        insetTop={false}
      />

      <main className="canvas-edge min-w-0 flex-1 overflow-y-auto bg-ui-sunken p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-[15px] text-ui-text-strong">Design specimen</h1>
            <p className="text-[12px] text-ui-text-muted">
              The rail on the left is the real component. Each card below is one
              preset's paper, rendered with its own tokens.
            </p>
          </div>
          <div className="flex gap-1">
            {(["light", "dark"] as Appearance[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAppearance(mode)}
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
    </div>
  );
}

/** A theme applied to a real element, so what is on screen is what `applyTheme`
 *  produces rather than an approximation of it. */
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
        <h2
          className="font-doc-heading text-doc-heading"
          style={{ fontSize: "var(--doc-h3)", fontWeight: "var(--doc-heading-weight)" }}
        >
          Getting Started
        </h2>
        <p
          className="mt-2 font-doc text-doc-text"
          style={{
            fontSize: "calc(var(--doc-size) * 0.8)",
            lineHeight: "var(--doc-leading)",
          }}
        >
          Ordinary paragraph text with a{" "}
          <span className="text-doc-link underline">link</span>, some{" "}
          <code
            className="rounded px-1 font-doc-mono"
            style={{ background: "var(--doc-code-bg)", fontSize: "0.85em" }}
          >
            inline code
          </code>
          , and enough words to judge the colour of the ink.
        </p>
        <blockquote
          className="mt-3 border-l-2 pl-3 font-doc text-doc-text-muted italic"
          style={{
            borderColor: "var(--doc-quote-bar)",
            fontSize: "calc(var(--doc-size) * 0.75)",
          }}
        >
          {note}
        </blockquote>
        <div className="mt-3 flex gap-1">
          {(["note", "tip", "important", "warning", "caution"] as const).map(
            (kind) => (
              <span
                key={kind}
                className="h-1.5 flex-1 rounded-full"
                style={{ background: `var(--doc-alert-${kind})` }}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
