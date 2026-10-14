import { describe, expect, it } from "vitest";
import { generateRouteSecret, routeKeyHash } from "./route-key";

describe("the MCP route secret", () => {
  it("is random and long", () => {
    const a = generateRouteSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateRouteSecret()).not.toBe(a);
  });

  it("is stored as a hash the database can compare, never itself", () => {
    const s = generateRouteSecret();
    expect(routeKeyHash(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(routeKeyHash(s)).not.toBe(s);
    expect(routeKeyHash(s)).toBe(routeKeyHash(s));
  });

  it("refuses to hash nothing", () => {
    expect(() => routeKeyHash("")).toThrow();
  });
});
