import { describe, expect, it } from "vitest";
import { routeKeyFor, routeKeyHash } from "./route-key";

describe("the MCP route key", () => {
  it("is the same for the same instance, and differs between instances", () => {
    expect(routeKeyFor("service-a")).toBe(routeKeyFor("service-a"));
    expect(routeKeyFor("service-a")).not.toBe(routeKeyFor("service-b"));
  });

  it("does not contain the service key it comes from", () => {
    expect(routeKeyFor("service-a-secret")).not.toContain("service-a-secret");
    expect(routeKeyFor("service-a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stored as a hash the database can compare, never itself", () => {
    const key = routeKeyFor("service-a");
    expect(routeKeyHash(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(routeKeyHash(key)).not.toBe(key);
  });

  it("refuses to derive from nothing", () => {
    expect(() => routeKeyFor("")).toThrow();
  });
});
