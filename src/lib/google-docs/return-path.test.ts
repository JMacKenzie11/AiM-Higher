import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it("keeps a path on this site, query and all", () => {
    expect(safeReturnPath("/coach/p1/c1?gdoc=m1")).toBe("/coach/p1/c1?gdoc=m1");
  });
  it("refuses anywhere else", () => {
    for (const bad of ["//evil.com/x", "https://evil.com", "/\\evil.com", "evil", "", null, "/a\r\nSet-Cookie: x"]) {
      expect(safeReturnPath(bad)).toBe("/ask-aimee");
    }
  });
});
