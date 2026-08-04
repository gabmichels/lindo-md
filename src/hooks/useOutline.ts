import { useEffect, useState } from "react";

import type { Heading } from "@/lib/ipc";

/**
 * Tracks which heading the reader is currently under, and how far through the
 * document they are.
 *
 * Uses scroll position rather than an `IntersectionObserver`: the active
 * heading is "the last one scrolled past", which an observer answers badly —
 * with several headings on screen at once it reports whichever crossed the
 * threshold last, which flickers when scrolling up.
 */

export interface OutlineState {
  activeId: string | null;
  /** 0–1, for the rail's reading-progress hairline. */
  progress: number;
}

/** How far down the viewport counts as "here". A heading is active once it has
 *  passed this line, so the reader's eye and the highlight agree. */
const ACTIVE_LINE = 0.25;

export function useOutline(
  toc: Heading[],
  scroller: HTMLElement | null,
): OutlineState {
  const [state, setState] = useState<OutlineState>({
    activeId: null,
    progress: 0,
  });

  useEffect(() => {
    if (!scroller || toc.length === 0) {
      setState({ activeId: null, progress: 0 });
      return;
    }

    let frame = 0;

    const measure = () => {
      frame = 0;
      const line = scroller.scrollTop + scroller.clientHeight * ACTIVE_LINE;

      let activeId: string | null = null;
      for (const heading of toc) {
        const element = scroller.querySelector<HTMLElement>(
          `[id="${CSS.escape(heading.id)}"]`,
        );
        if (!element) continue;
        if (element.offsetTop <= line) activeId = heading.id;
        else break;
      }

      const scrollable = scroller.scrollHeight - scroller.clientHeight;
      const progress = scrollable > 0 ? scroller.scrollTop / scrollable : 0;

      setState({
        activeId: activeId ?? toc[0]?.id ?? null,
        progress: Math.min(1, Math.max(0, progress)),
      });
    };

    // Scroll fires far more often than the screen refreshes; coalescing into one
    // measurement per frame keeps a long document smooth.
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(scroller);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [toc, scroller]);

  return state;
}
