import { describe, expect, it } from "vitest";
import { mergeServerValues } from "./grid-values";

describe("mergeServerValues", () => {
  it("shows a pulled value in a box nobody touched", () => {
    expect(mergeServerValues({ "m|w": "" }, { "m|w": "" }, { "m|w": "42" })).toEqual({
      "m|w": "42",
    });
  });

  it("keeps what the person typed and has not saved", () => {
    expect(
      mergeServerValues(
        { a: "7", b: "" },
        { a: "", b: "" },
        { a: "", b: "42" }
      )
    ).toEqual({ a: "7", b: "42" });
  });

  it("takes a value the server overwrote when the box still held the old one", () => {
    expect(mergeServerValues({ a: "10" }, { a: "10" }, { a: "12" })).toEqual({ a: "12" });
  });

  it("fills a box the grid did not hold before", () => {
    expect(mergeServerValues({}, {}, { a: "5" })).toEqual({ a: "5" });
  });

  it("after the person's own save, keeps their value, which the server now holds too", () => {
    expect(mergeServerValues({ a: "9" }, { a: "" }, { a: "9" })).toEqual({ a: "9" });
  });
});
