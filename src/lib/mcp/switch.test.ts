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

  it("admit every role but portfolio admins", () => {
    for (const role of ["system_admin", "company_admin", "aims_guide", "team_member"]) {
      expect(mcpOpenTo(role)).toBe(true);
    }
    for (const role of ["portfolio_admin", "someone_new", "", null, undefined]) {
      expect(mcpOpenTo(role)).toBe(false);
    }
  });

  it("no longer read MCP_FOR_EVERYONE", () => {
    vi.stubEnv("MCP_FOR_EVERYONE", "true");
    expect(mcpOpenTo("portfolio_admin")).toBe(false);
    vi.stubEnv("MCP_FOR_EVERYONE", "");
    expect(mcpOpenTo("team_member")).toBe(true);
  });
});
