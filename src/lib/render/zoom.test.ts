import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { enableDiagramZoom } from "./zoom";

/**
 * The viewer is DOM behaviour rather than a pure function, so these drive it the
 * way a reader does — a click, a wheel, a drag — and read the transform back.
 *
 * jsdom lays nothing out, so the stage's geometry is stubbed. That is the one
 * number the whole module is computed from, and stubbing it is what makes the
 * arithmetic (fit, centring, zoom about a point) testable at all.
 */

const STAGE = { left: 0, top: 0, width: 800, height: 400 };
const DIAGRAM = { width: 1000, height: 500 };
/** min(800/1000, 400/500) — the width is the binding constraint. */
const FIT = 0.8;

let root: HTMLElement;
let stop: () => void;

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const box = this.classList.contains("diagram-zoom-stage")
      ? STAGE
      : { left: 0, top: 0, width: 0, height: 0 };
    return {
      ...box,
      right: box.width,
      bottom: box.height,
      x: box.left,
      y: box.top,
      toJSON: () => box,
    };
  };
  // Not implemented in jsdom, and panning captures on the first move.
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;

  root = document.createElement("div");
  root.innerHTML = `<figure class="mermaid"><svg viewBox="0 0 ${DIAGRAM.width} ${DIAGRAM.height}"><g></g></svg></figure>`;
  document.body.append(root);
  stop = enableDiagramZoom(root);
});

afterEach(() => {
  stop();
  root.remove();
});

function openViewer(): HTMLElement {
  root.querySelector("figure")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const overlay = document.getElementById("lindo-md-zoom");
  if (!overlay) throw new Error("the viewer did not open");
  return overlay;
}

function stageOf(overlay: HTMLElement): HTMLElement {
  return overlay.querySelector<HTMLElement>(".diagram-zoom-stage")!;
}

function canvasOf(overlay: HTMLElement): HTMLElement {
  return overlay.querySelector<HTMLElement>(".diagram-zoom-canvas")!;
}

/** The transform back as numbers, so a test can assert on the view rather than
 *  on a string it would have to keep in step with the format. */
function view(overlay: HTMLElement): { x: number; y: number; scale: number } {
  const [x, y, scale] = [...canvasOf(overlay).style.transform.matchAll(/-?[\d.]+(?=px|\))/g)].map(
    (match) => Number(match[0]),
  );
  return { x: x ?? 0, y: y ?? 0, scale: scale ?? 1 };
}

function pointer(type: string, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("the diagram viewer", () => {
  it("opens at fit, centred, with the drawing at its own geometry", () => {
    const overlay = openViewer();

    expect(view(overlay)).toEqual({ x: 0, y: 0, scale: FIT });
    // Sized from the viewBox, not from the figure in the document — which jsdom
    // reports as zero-sized, so a measured size would have opened at nothing.
    expect(canvasOf(overlay).style.width).toBe(`${DIAGRAM.width}px`);
    expect(overlay.querySelector("svg")).not.toBeNull();
  });

  it("keeps the point under the pointer fixed while the wheel zooms", () => {
    const overlay = openViewer();
    const at = { x: 640, y: 300 };
    const before = view(overlay);
    const drawingPoint = (before.x - at.x) / before.scale;

    stageOf(overlay).dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -240,
        clientX: at.x,
        clientY: at.y,
      }),
    );

    const after = view(overlay);
    expect(after.scale).toBeGreaterThan(before.scale);
    expect((after.x - at.x) / after.scale).toBeCloseTo(drawingPoint, 6);
  });

  it("will not zoom past the limits the fit sets", () => {
    const overlay = openViewer();
    const stage = stageOf(overlay);

    for (let i = 0; i < 60; i++) {
      stage.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: -240,
          clientX: 400,
          clientY: 200,
        }),
      );
    }
    expect(view(overlay).scale).toBeCloseTo(FIT * 24, 6);

    for (let i = 0; i < 120; i++) {
      stage.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 240,
          clientX: 400,
          clientY: 200,
        }),
      );
    }
    expect(view(overlay).scale).toBeCloseTo(FIT * 0.5, 6);
  });

  it("pans with a drag, and that drag does not close the viewer", () => {
    const overlay = openViewer();
    const stage = stageOf(overlay);

    stage.dispatchEvent(pointer("pointerdown", 100, 100));
    stage.dispatchEvent(pointer("pointermove", 150, 120));
    stage.dispatchEvent(pointer("pointerup", 150, 120));
    // The click a drag ends with — the reason the backdrop is not simply "any
    // click on the overlay".
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(view(overlay)).toEqual({ x: 50, y: 20, scale: FIT });
    expect(document.getElementById("lindo-md-zoom")).not.toBeNull();
  });

  it("resets to fit, and closes on the backdrop and on Escape", () => {
    const overlay = openViewer();
    const stage = stageOf(overlay);
    stage.dispatchEvent(pointer("pointerdown", 100, 100));
    stage.dispatchEvent(pointer("pointermove", 300, 300));
    stage.dispatchEvent(pointer("pointerup", 300, 300));

    overlay.querySelector<HTMLElement>('[aria-label="Fit to window"]')?.click();
    expect(view(overlay)).toEqual({ x: 0, y: 0, scale: FIT });

    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("lindo-md-zoom")).toBeNull();

    openViewer();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("lindo-md-zoom")).toBeNull();
  });

  it("does not open on a diagram that failed to render", () => {
    root.innerHTML = `<figure class="mermaid mermaid-error"><pre>bad</pre></figure>`;
    root.querySelector("figure")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("lindo-md-zoom")).toBeNull();
  });
});
