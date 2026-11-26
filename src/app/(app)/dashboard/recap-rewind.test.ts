import { describe, expect, it } from "vitest";
import { newRewindGate, onEnded, onTimeReport } from "./recap-rewind";

describe("recap rewind gate", () => {
  it("jumps back once, just before the end", () => {
    const g = newRewindGate();
    expect(onTimeReport(g, 50, 100)).toBe(false);
    expect(onTimeReport(g, 99.6, 100)).toBe(true);
    expect(onTimeReport(g, 99.8, 100)).toBe(false);
  });

  it("ignores a stale end report after play is pressed (the phone case)", () => {
    const g = newRewindGate();
    expect(onTimeReport(g, 99.6, 100)).toBe(true);
    // play pressed; the first report still says the old time
    expect(onTimeReport(g, 99.6, 100)).toBe(false);
    expect(onEnded(g)).toBe(false);
    // the jump lands, playback runs on
    expect(onTimeReport(g, 0.2, 100)).toBe(false);
    expect(onTimeReport(g, 99.7, 100)).toBe(true);
  });

  it("still catches a seek straight to the end", () => {
    const g = newRewindGate();
    expect(onEnded(g)).toBe(true);
    expect(onEnded(g)).toBe(false);
  });

  it("does nothing before the length is known", () => {
    const g = newRewindGate();
    expect(onTimeReport(g, 0, 0)).toBe(false);
  });
});
