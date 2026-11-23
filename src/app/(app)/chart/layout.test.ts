import { describe, expect, it } from "vitest";
import { fanDepth } from "./layout";

type N = { children: N[] };
const leaf = (): N => ({ children: [] });
const node = (...children: N[]): N => ({ children });

describe("fanDepth", () => {
  it("is 0 when the chart starts with several functions", () => {
    expect(fanDepth([node(leaf()), leaf()])).toBe(0);
  });

  it("walks down a single-card chain to the first row that branches", () => {
    // Visionary → Integrator → five functions
    const chart = [node(node(leaf(), node(leaf(), leaf()), leaf(), leaf(), leaf()))];
    expect(fanDepth(chart)).toBe(2);
  });

  it("stops at a lone leaf", () => {
    expect(fanDepth([leaf()])).toBe(0);
    expect(fanDepth([node(leaf())])).toBe(1);
  });

  it("is 0 for an empty chart", () => {
    expect(fanDepth([])).toBe(0);
  });
});
