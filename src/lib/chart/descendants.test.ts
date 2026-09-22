import { describe, it, expect } from "vitest";
import { descendantsOf, parentChoicesFor } from "./descendants";

// The guard that keeps the chart a tree.
//
// parent_function_id has no database constraint stopping a function
// being its own ancestor. Set Marketing's parent to Marketing and
// the row is legal, the chart's walk never reaches it from any root,
// and the function vanishes from the page that is meant to be the
// map of the company. Point it at one of its own children and the
// whole subtree goes with it.
//
// That stopped being hypothetical the moment the drawer offered a
// picker, because "Marketing" and "Marketing and Sales" sit next to
// each other in the list.

const TREE = [
  { id: "vis", title: "Visionary", parent_function_id: null, sort_order: 0 },
  { id: "int", title: "Integrator", parent_function_id: "vis", sort_order: 0 },
  { id: "mkt", title: "Marketing", parent_function_id: "int", sort_order: 0 },
  { id: "leads", title: "Lead Gen", parent_function_id: "mkt", sort_order: 0 },
  { id: "brand", title: "Brand", parent_function_id: "mkt", sort_order: 1 },
  { id: "ops", title: "Operations", parent_function_id: "int", sort_order: 1 },
];

describe("descendantsOf", () => {
  it("finds every level below, not just the children", () => {
    expect([...descendantsOf("int", TREE)].sort()).toEqual([
      "brand",
      "leads",
      "mkt",
      "ops",
    ]);
  });

  it("is empty for a leaf", () => {
    expect(descendantsOf("brand", TREE).size).toBe(0);
  });

  it("does not include the root itself", () => {
    expect(descendantsOf("mkt", TREE).has("mkt")).toBe(false);
  });

  it("terminates on a cycle that is already in the data", () => {
    // Not a shape this guard can produce, and exactly the shape it
    // would be asked to walk if one ever got in another way. A
    // recursive version hangs the request that was trying to stop
    // the next bad move.
    const cyclic = [
      { id: "a", title: "A", parent_function_id: "b", sort_order: 0 },
      { id: "b", title: "B", parent_function_id: "a", sort_order: 0 },
    ];
    expect([...descendantsOf("a", cyclic)].sort()).toEqual(["a", "b"]);
  });
});

describe("parentChoicesFor", () => {
  it("offers everything except itself and its own subtree", () => {
    const ids = parentChoicesFor("mkt", TREE).map((o) => o.id);
    expect(ids).toEqual(["vis", "int", "ops"]);
    expect(ids).not.toContain("mkt");
    expect(ids).not.toContain("leads");
    expect(ids).not.toContain("brand");
  });

  // Non-breaking spaces, not dashes. A closed select shows the
  // chosen option alone, where a leading "— " reads as part of the
  // function's name rather than as its depth.
  it("indents by depth so a flat select still reads as a tree", () => {
    const NB = "\u00a0\u00a0";
    expect(parentChoicesFor("ops", TREE)).toEqual([
      { id: "vis", title: "Visionary" },
      { id: "int", title: `${NB}Integrator` },
      { id: "mkt", title: `${NB}${NB}Marketing` },
      { id: "leads", title: `${NB}${NB}${NB}Lead Gen` },
      { id: "brand", title: `${NB}${NB}${NB}Brand` },
    ]);
  });

  it("offers the whole chart to a function that is not on it yet", () => {
    expect(parentChoicesFor("nobody", TREE)).toHaveLength(TREE.length);
  });

  it("orders siblings by sort_order, then title", () => {
    const rows = [
      { id: "a", title: "Zulu", parent_function_id: null, sort_order: 0 },
      { id: "b", title: "Alpha", parent_function_id: null, sort_order: 1 },
      { id: "c", title: "Bravo", parent_function_id: null, sort_order: 1 },
    ];
    expect(parentChoicesFor("x", rows).map((o) => o.title)).toEqual([
      "Zulu",
      "Alpha",
      "Bravo",
    ]);
  });
});
