/**
 * The download reports chunk lengths, not a running total, and the progress bar is the only
 * thing telling a reader that an install which is about to restart their app is proceeding.
 * Getting the accumulation wrong does not throw — it draws a bar that sits near zero for the
 * whole download and reads as a hang, which is exactly when someone force-quits an app
 * mid-install.
 */
import { describe, expect, it } from "vitest";

import { NOT_STARTED, advance, updateChannel, type DownloadProgress } from "./update";

function started(contentLength?: number) {
  return { event: "Started" as const, data: { contentLength } };
}
function chunk(chunkLength: number) {
  return { event: "Progress" as const, data: { chunkLength } };
}
const FINISHED = { event: "Finished" as const };

/** Replays a whole download, as the plugin would deliver it. */
function replay(events: Parameters<typeof advance>[1][]): DownloadProgress {
  return events.reduce(advance, NOT_STARTED);
}

describe("advance", () => {
  it("accumulates chunks rather than reporting the last one", () => {
    const progress = replay([started(1000), chunk(250), chunk(250)]);

    expect(progress.received).toBe(500);
    expect(progress.fraction).toBe(0.5);
  });

  it("runs a whole download from nothing to done", () => {
    const progress = replay([started(400), chunk(100), chunk(100), chunk(200), FINISHED]);

    expect(progress.fraction).toBe(1);
    expect(progress.received).toBe(400);
  });

  it("clamps a total the server undercounted", () => {
    // A wrong `Content-Length` is the server's mistake and must not become a bar that
    // runs off the end of its track.
    expect(replay([started(100), chunk(250)]).fraction).toBe(1);
  });

  it("is indeterminate when no length was sent", () => {
    const progress = replay([started(), chunk(500)]);

    expect(progress.total).toBeNull();
    expect(progress.fraction).toBeNull();
    // Still counted, so the bytes are there if the UI wants to say how much arrived.
    expect(progress.received).toBe(500);
  });

  it("treats a zero-length header as no length at all", () => {
    // Dividing by it would give Infinity or NaN, and NaN reaches CSS as `NaN%`.
    expect(replay([started(0), chunk(10)]).fraction).toBeNull();
  });

  it("completes even a download whose size was never known", () => {
    // Arriving is the one thing an indeterminate download can still report honestly.
    expect(replay([started(), chunk(10), FINISHED]).fraction).toBe(1);
  });

  it("starts from zero rather than null when the length is known", () => {
    // A determinate bar has to render as empty, not as indeterminate, before the first
    // chunk lands — otherwise every download flickers through a pulsing state.
    expect(replay([started(1000)]).fraction).toBe(0);
  });
});

describe("updateChannel", () => {
  it("lets the published builds update themselves", () => {
    expect(updateChannel("windows")).toBe("in-app");
    expect(updateChannel("linux")).toBe("in-app");
  });

  it("sends macOS to source, because no macOS bundle is published to install", () => {
    // Not a preference: `release.yml` builds no darwin artifact, so `latest.json` has no
    // darwin entry and there is nothing for `check()` to find. If a signed macOS bundle
    // is ever published, this is the line that changes.
    expect(updateChannel("macos")).toBe("source");
  });
});
