import { useCallback, useEffect, useState } from "react";

import { onTreeChanged, scanFolder, type TreeNode } from "@/lib/ipc";

/** Scans the open folder and re-scans when files appear or disappear. */
export function useFileTree(
  folder: string | null,
  respectGitignore: boolean,
  showHidden: boolean,
) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const rescan = useCallback(() => {
    if (!folder) {
      setTree([]);
      setError(null);
      return;
    }
    setLoading(true);
    scanFolder(folder, respectGitignore, showHidden)
      .then((next) => {
        setTree(next);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [folder, respectGitignore, showHidden]);

  useEffect(rescan, [rescan]);

  useEffect(() => {
    if (!folder) return;
    const unlisten = onTreeChanged(rescan);
    return () => {
      void unlisten.then((off) => off());
    };
  }, [folder, rescan]);

  return { tree, loading, error, rescan };
}

/** Flattens a tree into the paths of every document in it, in display order —
 *  what "next/previous document" navigates through. */
export function flattenDocuments(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.isDir ? flattenDocuments(node.children) : [node.path],
  );
}

/** The directory paths that must be expanded for `path` to be visible. */
export function ancestorsOf(nodes: TreeNode[], path: string): string[] {
  for (const node of nodes) {
    if (!node.isDir) continue;
    if (path.startsWith(node.path)) {
      return [node.path, ...ancestorsOf(node.children, path)];
    }
  }
  return [];
}
