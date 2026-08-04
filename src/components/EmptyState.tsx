import { FileText, FolderOpen } from "lucide-react";

import { basename, cn } from "@/lib/utils";

/**
 * What the window shows before anything is open.
 *
 * Deliberately not a logo and a shrug: the two things a reader can do are right
 * there, and the recents list is the fastest route back to what they were
 * reading yesterday.
 */

interface EmptyStateProps {
  recentFiles: string[];
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenRecent: (path: string) => void;
}

export function EmptyState({
  recentFiles,
  onOpenFile,
  onOpenFolder,
  onOpenRecent,
}: EmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center bg-doc-bg p-8">
      <div className="w-full max-w-md">
        <h1 className="font-doc-heading text-doc-heading text-2xl">pretty-md</h1>
        <p className="mt-1 font-doc text-doc-text-muted">
          Open a Markdown file, or a folder of them.
        </p>

        <div className="mt-6 flex gap-2">
          <PrimaryAction icon={FileText} label="Open file…" onClick={onOpenFile} />
          <PrimaryAction icon={FolderOpen} label="Open folder…" onClick={onOpenFolder} />
        </div>

        {recentFiles.length > 0 && (
          <div className="mt-10">
            <p className="font-doc-heading text-doc-text-muted text-[11px] tracking-[0.08em] uppercase">
              Recent
            </p>
            <ul className="mt-2">
              {recentFiles.slice(0, 8).map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => onOpenRecent(path)}
                    title={path}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left",
                      "font-doc-heading text-[13px] text-doc-text",
                      "transition-colors duration-[var(--ui-dur)] hover:bg-doc-surface",
                    )}
                  >
                    <span className="shrink-0">{basename(path)}</span>
                    <span className="truncate text-[11.5px] text-doc-text-muted">
                      {path}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function PrimaryAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2",
        "font-doc-heading text-[13px] text-doc-text",
        "bg-doc-surface transition-colors duration-[var(--ui-dur)]",
        "hover:text-doc-link",
      )}
    >
      <Icon size={15} strokeWidth={1.5} aria-hidden />
      {label}
    </button>
  );
}
