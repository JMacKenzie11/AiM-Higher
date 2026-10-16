import { describe, expect, it } from "vitest";
import { menuFocusIndex } from "./useMenuButton";

// The arrow-key rules of the menu button pattern. The suite runs in
// node with no DOM, so the focus moves themselves are covered by the
// manual keyboard pass in the PR; what is pinned here is where each
// key goes, which is the part that is easy to get off by one.

describe("menuFocusIndex", () => {
  it("ArrowDown moves to the next item and wraps from the last to the first", () => {
    expect(menuFocusIndex("ArrowDown", 0, 3)).toBe(1);
    expect(menuFocusIndex("ArrowDown", 1, 3)).toBe(2);
    expect(menuFocusIndex("ArrowDown", 2, 3)).toBe(0);
  });

  it("ArrowUp moves to the previous item and wraps from the first to the last", () => {
    expect(menuFocusIndex("ArrowUp", 2, 3)).toBe(1);
    expect(menuFocusIndex("ArrowUp", 1, 3)).toBe(0);
    expect(menuFocusIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("Home and End jump to the first and last item", () => {
    expect(menuFocusIndex("Home", 2, 4)).toBe(0);
    expect(menuFocusIndex("End", 0, 4)).toBe(3);
  });

  it("with focus on no item, ArrowDown goes to the first and ArrowUp to the last", () => {
    expect(menuFocusIndex("ArrowDown", -1, 3)).toBe(0);
    expect(menuFocusIndex("ArrowUp", -1, 3)).toBe(2);
  });

  it("a single item stays put", () => {
    expect(menuFocusIndex("ArrowDown", 0, 1)).toBe(0);
    expect(menuFocusIndex("ArrowUp", 0, 1)).toBe(0);
  });

  it("does nothing in an empty menu or for keys it does not own", () => {
    expect(menuFocusIndex("ArrowDown", -1, 0)).toBeNull();
    expect(menuFocusIndex("Enter", 0, 3)).toBeNull();
    expect(menuFocusIndex("a", 0, 3)).toBeNull();
  });
});
