import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * A counter that says "the annotation store changed", and nothing else.
 *
 * There are now two places a mark can be written from — the context menu on the
 * document, and the panel beside it — and each has to notice what the other did.
 * The alternatives were both worse than a number. Lifting `useAnnotations` to the
 * shell would make one hook responsible for every mounted view's marks, when its
 * whole design is one document's; handing the panel a callback per operation
 * would put the page's reload in the panel's hands and leave the reverse
 * direction still missing.
 *
 * **What travels is the fact of a change, never the data.** Whoever cares
 * re-reads the store, which is the only version anyone should be trusting after
 * a write anyway: SQLite decides ids and timestamps, and a panel row updated from
 * an optimistic local copy is a row that disagrees with the file it came from.
 * Re-listing a document's marks costs one indexed query and the resolve loop that
 * already runs on every save.
 */

interface RevisionValue {
  revision: number;
  /** Say that something in the store changed. Safe to call from anywhere; it is
   *  a `setState` on one number and nothing reads it synchronously. */
  bump: () => void;
}

// Defaulted rather than left undefined, so a view mounted outside the provider —
// a test rendering one `DocumentView`, a future window — still works, with each
// side simply not hearing about the other's writes. A thrown "must be used
// within a provider" would make annotations depend on the shell.
const RevisionContext = createContext<RevisionValue>({
  revision: 0,
  bump: () => undefined,
});

export function AnnotationRevisionProvider({ children }: { children: ReactNode }): ReactNode {
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);
  // Memoized on the two values it holds: this provider wraps the whole shell, so
  // a fresh object every render would re-run the load effect of every document
  // that depends on it — which is exactly the reload this exists to trigger, on
  // renders where nothing was written.
  const value = useMemo(() => ({ revision, bump }), [revision, bump]);

  return <RevisionContext.Provider value={value}>{children}</RevisionContext.Provider>;
}

export function useAnnotationRevision(): RevisionValue {
  return useContext(RevisionContext);
}
