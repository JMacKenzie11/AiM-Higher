import { describe, it, expect } from "vitest";
import { headlineAreas, leadershipSeatIds } from "./areas";

// The leadership seats give no headline in the meeting (Jason,
// 2026-10-20), whatever they are called.

const fn = (id: string, title: string, parent: string | null = null) => ({ id, title, parent_function_id: parent });

describe("headlineAreas", () => {
  it("leaves out the Visionary and Integrator of the seeded chart", () => {
    const chart = [fn("v", "Visionary"), fn("i", "Integrator", "v"), fn("s", "Sales", "i"), fn("o", "Operations", "i")];
    expect(headlineAreas(chart).map((f) => f.id)).toEqual(["s", "o"]);
  });

  it("finds them by place when they are renamed", () => {
    const chart = [fn("v", "Owner"), fn("i", "General Manager", "v"), fn("s", "Sales", "i"), fn("t", "Tankhouse", "i")];
    expect([...leadershipSeatIds(chart)].sort()).toEqual(["i", "v"]);
  });

  it("finds a CEO and COO by name in a chart shaped differently", () => {
    const chart = [fn("c", "CEO"), fn("o", "COO", "c"), fn("s", "Sales", "c"), fn("m", "Marketing", "c")];
    expect(headlineAreas(chart).map((f) => f.id)).toEqual(["s", "m"]);
  });

  it("keeps a sub-area under an area, and every top box of a chart with several", () => {
    const chart = [fn("s", "Sales"), fn("is", "Inside sales", "s"), fn("o", "Operations")];
    expect(headlineAreas(chart).map((f) => f.id)).toEqual(["s", "is", "o"]);
  });

  it("keeps an area under the Visionary when there is no Integrator", () => {
    const chart = [fn("v", "Visionary"), fn("s", "Sales", "v"), fn("o", "Operations", "v")];
    expect(headlineAreas(chart).map((f) => f.id)).toEqual(["s", "o"]);
  });
});
