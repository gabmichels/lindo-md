import { useRef } from "react";

import { DocumentView } from "@/components/DocumentView";
import type { TabRuntime } from "@/hooks/useTabDocuments";
import type { Session } from "@/lib/tabs/model";
import type { Theme } from "@/lib/theme/schema";

/**
 * Every loaded tab's document, with the inactive ones hidden rather than
 * unmounted.
 *
 * That is the whole reason this component exists. `enhance()` records what it
 * has already done — highlighted code, rendered diagrams — on the DOM nodes
 * themselves, so keeping those nodes alive makes returning to a tab nearly
 * free, while rebuilding them means paying for syntax highlighting and Mermaid
 * again on every switch.
 *
 * Retention is capped: a reader with thirty tabs open should not be holding
 * thirty rendered documents. Past the cap the least recently used view is
 * dropped and re-rendered from its cached `Document` when it comes back, which
 * costs a re-highlight but no IPC and no re-parse.
 */

const RETAINED = 8;

interface DocumentDeckProps {
  session: Session;
  runtimes: Record<string, TabRuntime>;
  theme: Theme;
  blockRemoteImages: boolean;
  onOpenDocument: (tabId: string, path: string, fragment: string) => void;
  onAnchorConsumed: (tabId: string) => void;
  onScrollChange: (tabId: string, scrollTop: number) => void;
  onScrollerReady: (element: HTMLElement | null) => void;
}

export function DocumentDeck({
  session,
  runtimes,
  theme,
  blockRemoteImages,
  onOpenDocument,
  onAnchorConsumed,
  onScrollChange,
  onScrollerReady,
}: DocumentDeckProps) {
  const mru = useRef<string[]>([]);
  const active = session.activeTabId;
  if (active && mru.current[0] !== active) {
    mru.current = [active, ...mru.current.filter((id) => id !== active)];
  }

  const retained = new Set(mru.current.slice(0, RETAINED));

  return (
    <>
      {session.tabs.map((tab) => {
        const runtime = runtimes[tab.id];
        if (!runtime?.document || !retained.has(tab.id)) return null;

        return (
          <DocumentView
            key={tab.id}
            document={runtime.document}
            theme={theme}
            blockRemoteImages={blockRemoteImages}
            pendingAnchor={runtime.pendingAnchor}
            visible={tab.id === active}
            restoreScrollTop={runtime.scrollTop}
            onAnchorConsumed={() => onAnchorConsumed(tab.id)}
            onOpenDocument={(path, fragment) =>
              onOpenDocument(tab.id, path, fragment)
            }
            onScrollChange={(scrollTop) => onScrollChange(tab.id, scrollTop)}
            onScrollerReady={onScrollerReady}
          />
        );
      })}
    </>
  );
}
