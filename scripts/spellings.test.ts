import { describe, it, expect } from "vitest";
import { parseSet } from "./spellings";

describe("parseSet", () => {
  it("reads a spelling and its misheard forms", () => {
    expect(parseSet("Grand Manan=Graham and Ann| Grand Menan ")).toEqual({
      spelling: "Grand Manan",
      heard_as: ["Graham and Ann", "Grand Menan"],
    });
  });

  it("reads a spelling correct as it stands", () => {
    expect(parseSet("Kylie=")).toEqual({ spelling: "Kylie", heard_as: [] });
  });

  it("refuses a malformed argument rather than guessing", () => {
    expect(() => parseSet("Grand Manan")).toThrow();
    expect(() => parseSet("=Graham and Ann")).toThrow();
  });
});
