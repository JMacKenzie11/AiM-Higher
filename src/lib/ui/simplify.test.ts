import { describe, expect, it } from "vitest";
import { __test, SIMPLIFY_CHANGES } from "./simplify";

const { parse } = __test;

describe("simplify switches", () => {
  it("is all off when unset, as production is", () => {
    expect(parse(undefined).size).toBe(0);
    expect(parse("").size).toBe(0);
  });

  it("turns every change on for all", () => {
    expect([...parse("all")]).toEqual([...SIMPLIFY_CHANGES]);
  });

  it("reads a list and ignores names it does not know", () => {
    expect([...parse(" main-action , not-a-change")]).toEqual(["main-action"]);
  });
});
