import { afterEach, describe, it, expect, vi } from "vitest";
import { mcpEnabled, mcpOpenTo } from "./switch";

afterEach(() => vi.unstubAllEnvs());

describe("the outside assistant switches", () => {
  it("are off unless switched on", () => {
    vi.stubEnv("MCP_ENABLED", "");
    expect(mcpEnabled()).toBe(false);
    vi.stubEnv("MCP_ENABLED", "true");
    expect(mcpEnabled()).toBe(true);
  });

  it("run only on the instances named, when any are named", () => {
    vi.stubEnv("MCP_ENABLED", "true");
    vi.stubEnv("MCP_INSTANCES", "@");
    expect(mcpEnabled("@")).toBe(true);
    expect(mcpEnabled("promiseone")).toBe(false);
    // Asked without an instance while a list is set: no.
    expect(mcpEnabled()).toBe(false);
    vi.stubEnv("MCP_INSTANCES", "");
    expect(mcpEnabled("promiseone")).toBe(true);
    vi.stubEnv("MCP_ENABLED", "");
    vi.stubEnv("MCP_INSTANCES", "@");
    expect(mcpEnabled("@")).toBe(false);
  });

  it("admit system admins only, until opened to everyone", () => {
    vi.stubEnv("MCP_FOR_EVERYONE", "");
    expect(mcpOpenTo("system_admin")).toBe(true);
    for (const role of ["company_admin", "team_member", "aims_guide", "portfolio_admin", null]) {
      expect(mcpOpenTo(role)).toBe(false);
    }
    vi.stubEnv("MCP_FOR_EVERYONE", "true");
    expect(mcpOpenTo("team_member")).toBe(true);
  });
});
