/**
 * Click-to-zoom for diagrams.
 *
 * Diagrams are routinely wider than the reading measure, and shrinking one to
 * fit makes its labels unreadable — which is the whole content of a diagram.
 * Clicking opens it full-window, scaled to fit, with the original SVG cloned so
 * it stays vector-sharp at any size.
 *
 * Implemented at the DOM level like the other enhancement passes rather than as
 * a React component: the figures it attaches to are created imperatively by
 * `mermaid.ts`, and React never owns them.
 */

const OVERLAY_ID = "lindo-md-zoom";

export function enableDiagramZoom(root: HTMLElement): () => void {
  const onClick = (event: MouseEvent) => {
    const figure = (event.target as Element | null)?.closest("figure.mermaid:not(.mermaid-error)");
    if (figure) open(figure as HTMLElement);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const figure = (event.target as Element | null)?.closest("figure.mermaid:not(.mermaid-error)");
    if (!figure) return;
    event.preventDefault();
    open(figure as HTMLElement);
  };

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);

  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKeyDown);
    close();
  };
}

function open(figure: HTMLElement): void {
  close();

  const svg = figure.querySelector("svg");
  if (!svg) return;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "diagram-zoom";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Diagram, enlarged");
  overlay.tabIndex = -1;

  const stage = document.createElement("div");
  stage.className = "diagram-zoom-stage";
  const clone = svg.cloneNode(true) as SVGElement;
  // The figure caps the diagram at its natural width; enlarged, it should use
  // whatever room the window has.
  clone.style.maxWidth = "none";
  clone.style.width = "100%";
  clone.style.height = "100%";
  stage.append(clone);

  const hint = document.createElement("p");
  hint.className = "diagram-zoom-hint";
  hint.textContent = "Click anywhere or press Escape to close";

  overlay.append(stage, hint);
  overlay.addEventListener("click", close);
  document.body.append(overlay);
  overlay.focus();

  document.addEventListener("keydown", onOverlayKey);
}

function onOverlayKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    // Stopped here so the app's own Escape handler does not also close the find
    // bar behind the overlay.
    event.stopPropagation();
    close();
  }
}

function close(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  document.removeEventListener("keydown", onOverlayKey);
}
