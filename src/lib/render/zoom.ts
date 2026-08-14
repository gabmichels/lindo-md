/**
 * The diagram viewer: click a diagram to open it full-window, then pan and zoom.
 *
 * Diagrams are routinely wider than the reading measure, and shrinking one to
 * fit makes its labels unreadable — which is the whole content of a diagram.
 * Fitting it to the *window* is better and was the first version of this, but it
 * only moves the ceiling: a large ERD is unreadable at window width too, and a
 * drawing you cannot read the labels of is a picture of a diagram rather than a
 * diagram. So the overlay is a viewport onto the drawing rather than a bigger
 * copy of it — opening at fit, and taking the reader in from there.
 *
 * The SVG is cloned rather than moved, and scaled with a CSS transform rather
 * than by rewriting the viewBox, so it stays vector-sharp at any magnification
 * and the figure in the document is never disturbed.
 *
 * Implemented at the DOM level like the other enhancement passes rather than as
 * a React component: the figures it attaches to are created imperatively by
 * `mermaid.ts`, and React never owns them.
 */

const OVERLAY_ID = "lindo-md-zoom";

/** How far the scale may travel from the fit that opened the view. The floor
 *  exists so a diagram cannot be shrunk to a speck it is hard to find again;
 *  the ceiling is generous because the whole point is reading small labels. */
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 24;

/** One notch of the zoom buttons and the keyboard. A wheel gesture is
 *  continuous and uses its own delta instead. */
const STEP = 1.25;

/** Arrow-key pan, in viewport pixels — independent of scale, because it is a
 *  nudge of the view rather than a distance in the drawing. */
const NUDGE = 60;

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

/** Where the drawing currently sits in the viewport: the top-left of the scaled
 *  drawing, in viewport pixels, and the scale it is drawn at. */
interface View {
  x: number;
  y: number;
  scale: number;
}

function open(figure: HTMLElement): void {
  close();

  const svg = figure.querySelector("svg");
  if (!svg) return;

  const size = intrinsicSize(svg);
  if (!size) return;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "diagram-zoom";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Diagram, enlarged");
  overlay.tabIndex = -1;

  const stage = document.createElement("div");
  stage.className = "diagram-zoom-stage";

  const canvas = document.createElement("div");
  canvas.className = "diagram-zoom-canvas";
  // Sharing the original's id is deliberate rather than overlooked: every rule
  // Mermaid writes is scoped to it (`#mermaid-4 .node rect`), those rules are
  // re-installed as an adopted stylesheet because CSP makes the `<style>` inside
  // the SVG inert (see `mermaid.ts`), and a CSS id selector matches *every*
  // element carrying the id — it is `getElementById` that returns only the first.
  // So the clone is styled by the sheet the original already has, and giving it
  // an id of its own would mean maintaining a second copy of that stylesheet for
  // no gain. Confirmed in the running app over CDP, not assumed.
  const clone = svg.cloneNode(true) as SVGElement;
  // The figure caps the diagram at its natural width and lets the page decide
  // its height; in here it is laid out at its own geometry and everything about
  // where it appears is the transform's business.
  clone.style.maxWidth = "none";
  clone.style.width = `${size.width}px`;
  clone.style.height = `${size.height}px`;
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  canvas.append(clone);
  stage.append(canvas);

  const readout = document.createElement("output");
  readout.className = "diagram-zoom-level";
  // A live region rather than a label: the number changes under the reader's own
  // gesture, and the gesture is what they are watching.
  readout.setAttribute("aria-live", "polite");

  let view: View = { x: 0, y: 0, scale: 1 };
  let fit = 1;

  const draw = () => {
    canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    readout.textContent = `${Math.round(view.scale * 100)}%`;
  };

  /** Fits the drawing to the stage and centres it. Also the reset, which is why
   *  it recomputes `fit` rather than trusting the one from open time — the
   *  window can be resized while the overlay is up. */
  const fitToStage = () => {
    const bounds = stage.getBoundingClientRect();
    // A stage with no layout yet (jsdom, or a frame where the overlay is not
    // measured) would otherwise scale the drawing to nothing.
    if (bounds.width <= 0 || bounds.height <= 0) return;
    fit = Math.min(bounds.width / size.width, bounds.height / size.height);
    view = {
      scale: fit,
      x: (bounds.width - size.width * fit) / 2,
      y: (bounds.height - size.height * fit) / 2,
    };
    draw();
  };

  /**
   * Scales about a point in the stage, so whatever is under the pointer stays
   * under the pointer. Zooming about the centre instead is the difference
   * between steering and hunting: on a diagram twenty screens wide, a
   * centre-anchored zoom moves the thing you were reading off-screen.
   */
  const zoomTo = (next: number, originX: number, originY: number) => {
    const scale = clamp(next, fit * MIN_FACTOR, fit * MAX_FACTOR);
    if (scale === view.scale) return;
    const ratio = scale / view.scale;
    view = {
      scale,
      x: originX - (originX - view.x) * ratio,
      y: originY - (originY - view.y) * ratio,
    };
    draw();
  };

  /** The centre of the stage, for the zoom that has no pointer behind it — the
   *  buttons and the keyboard. */
  const centre = (): [number, number] => {
    const bounds = stage.getBoundingClientRect();
    return [bounds.width / 2, bounds.height / 2];
  };

  const zoomBy = (factor: number) => {
    const [x, y] = centre();
    zoomTo(view.scale * factor, x, y);
  };

  const onWheel = (event: WheelEvent) => {
    // Both gestures land here: a wheel notch, and a trackpad pinch, which
    // Chromium reports as a wheel with `ctrlKey` set. Neither should scroll the
    // document behind the overlay.
    event.preventDefault();
    const bounds = stage.getBoundingClientRect();
    // Exponential in the delta, so the same physical gesture covers the same
    // proportion of the range wherever it starts. `deltaMode` 1 is lines rather
    // than pixels, which is a much coarser unit.
    const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomTo(
      view.scale * Math.exp(-pixels / 400),
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    );
  };

  // Panning, and the reason the backdrop click below is not simply "any click":
  // a drag that ends over the backdrop is still a drag, and closing the viewer
  // under someone who was moving the drawing is the one unrecoverable action
  // here. `dragged` records that the pointer travelled, and the click that
  // follows a travelled drag is not a dismissal.
  let panning: number | null = null;
  let dragged = false;
  let last = { x: 0, y: 0 };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    panning = event.pointerId;
    dragged = false;
    last = { x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-panning");
  };

  const onPointerMove = (event: PointerEvent) => {
    if (panning !== event.pointerId) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) dragged = true;
    last = { x: event.clientX, y: event.clientY };
    view = { ...view, x: view.x + dx, y: view.y + dy };
    draw();
  };

  const endPan = (event: PointerEvent) => {
    if (panning !== event.pointerId) return;
    panning = null;
    stage.classList.remove("is-panning");
  };

  const onDoubleClick = (event: MouseEvent) => {
    const bounds = stage.getBoundingClientRect();
    zoomTo(view.scale * STEP * STEP, event.clientX - bounds.left, event.clientY - bounds.top);
  };

  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", endPan);
  stage.addEventListener("pointercancel", endPan);
  stage.addEventListener("dblclick", onDoubleClick);

  const controls = document.createElement("div");
  controls.className = "diagram-zoom-controls";
  controls.append(
    button("Zoom out", "−", () => {
      zoomBy(1 / STEP);
    }),
    readout,
    button("Zoom in", "+", () => {
      zoomBy(STEP);
    }),
    button("Fit to window", "Fit", fitToStage),
    button("Close", "✕", close),
  );

  const hint = document.createElement("p");
  hint.className = "diagram-zoom-hint";
  hint.textContent = "Drag to pan · scroll to zoom · Escape to close";

  overlay.append(stage, controls, hint);

  // The backdrop is a dismissal; the drawing and the controls are not. The
  // previous version closed on any click in the overlay, which a pan would now
  // trigger on every release.
  //
  // Capture phase, so this sees every click in the overlay including the ones a
  // control stops. Clearing `dragged` only from clicks that reach the bubble
  // phase leaves it set after a pan followed by a button press, and the next
  // backdrop click is then swallowed as if it were a drag — which is the viewer
  // refusing to close for no reason the reader can see.
  overlay.addEventListener(
    "click",
    (event) => {
      const wasDrag = dragged;
      dragged = false;
      if (wasDrag) return;
      if (event.target === overlay || event.target === hint) close();
    },
    true,
  );

  document.body.append(overlay);
  overlay.focus();
  fitToStage();

  activeView = {
    fitToStage,
    zoomBy,
    pan: (dx, dy) => {
      view = { ...view, x: view.x + dx, y: view.y + dy };
      draw();
    },
  };

  window.addEventListener("resize", onResize);
  document.addEventListener("keydown", onOverlayKey, true);
}

/** The handles the window-level listeners act on, so the key and resize
 *  handlers stay module-level functions that `close` can unregister by
 *  reference. Null whenever no overlay is open. */
let activeView: {
  fitToStage: () => void;
  zoomBy: (factor: number) => void;
  pan: (dx: number, dy: number) => void;
} | null = null;

function onResize(): void {
  // Refitting rather than preserving the view: a resize changes what "fit"
  // means, and a scale expressed relative to a stale fit would fall outside its
  // own limits.
  activeView?.fitToStage();
}

function onOverlayKey(event: KeyboardEvent): void {
  if (!activeView) return;

  if (event.key === "Escape") {
    // Stopped here so the app's own Escape handler does not also close the find
    // bar behind the overlay.
    event.stopPropagation();
    close();
    return;
  }

  const pan = (dx: number, dy: number) => {
    activeView?.pan(dx, dy);
  };

  switch (event.key) {
    case "+":
    case "=":
      activeView.zoomBy(STEP);
      break;
    case "-":
    case "_":
      activeView.zoomBy(1 / STEP);
      break;
    case "0":
      activeView.fitToStage();
      break;
    case "ArrowLeft":
      pan(NUDGE, 0);
      break;
    case "ArrowRight":
      pan(-NUDGE, 0);
      break;
    case "ArrowUp":
      pan(0, NUDGE);
      break;
    case "ArrowDown":
      pan(0, -NUDGE);
      break;
    default:
      return;
  }

  // Only for the keys handled above — anything else keeps its ordinary meaning,
  // and the overlay is not the only thing listening.
  event.preventDefault();
  event.stopPropagation();
}

function close(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  activeView = null;
  window.removeEventListener("resize", onResize);
  document.removeEventListener("keydown", onOverlayKey, true);
}

function button(label: string, glyph: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "diagram-zoom-button";
  element.setAttribute("aria-label", label);
  element.title = label;
  element.textContent = glyph;
  element.addEventListener("click", (event) => {
    // The overlay's own click handler treats the backdrop as a dismissal, and a
    // control that closed the viewer as well as acting would be unusable.
    event.stopPropagation();
    onClick();
  });
  return element;
}

/**
 * The drawing's own pixel size.
 *
 * Read from the viewBox rather than from `getBoundingClientRect`, because the
 * figure in the document has already been laid out to *its* width — measuring
 * that would open the viewer at whatever the page happened to squeeze the
 * diagram into. `mermaid.ts` rewrites the viewBox from the real geometry after
 * every render, so it is the trustworthy number.
 */
function intrinsicSize(svg: SVGElement): { width: number; height: number } | null {
  const parts = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [, , width, height] = parts;
  if (parts.length === 4 && width && height && width > 0 && height > 0) {
    return { width, height };
  }

  const box = svg.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? { width: box.width, height: box.height } : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
