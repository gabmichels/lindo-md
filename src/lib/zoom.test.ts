import { describe, expect, it } from "vitest";

import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom, stepZoom } from "./zoom";

describe("stepZoom", () => {
  it("moves by one step", () => {
    expect(stepZoom(1, ZOOM_STEP)).toBe(1.1);
    expect(stepZoom(1, -ZOOM_STEP)).toBe(0.9);
  });

  it("stays on a tenth across a run of steps", () => {
    // 0.7 + 0.1 is 0.7999999999999999 in binary floating point. Without the
    // rounding the read-out would show 80% while the stored value made the next
    // step land somewhere else, and the drift would compound.
    let zoom = 0.7;
    for (let i = 0; i < 5; i++) zoom = stepZoom(zoom, ZOOM_STEP);
    expect(zoom).toBe(1.2);
  });

  it("stops at the bounds rather than running past them", () => {
    expect(stepZoom(ZOOM_MAX, ZOOM_STEP)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -ZOOM_STEP)).toBe(ZOOM_MIN);
  });
});

describe("clampZoom", () => {
  it("bounds values from a hand-edited config file", () => {
    expect(clampZoom(40)).toBe(ZOOM_MAX);
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(1.4)).toBe(1.4);
  });

  it("replaces a non-finite value instead of bounding it", () => {
    // NaN survives Math.min/Math.max and would reach CSS as `NaNpx`, blanking
    // the document.
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
  });
});
