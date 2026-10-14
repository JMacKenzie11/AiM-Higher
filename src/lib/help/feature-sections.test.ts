import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { filterFeatureSections, helpDocProblems, helpFeaturesFor, loadAllHelpFor } from "./loader";

const doc = ["Before.", "", "::: feature outside_assistants", "Secret help.", ":::", "", "After."].join("\n");

describe("feature-scoped help sections", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps a feature's section for someone who has it", () => {
    expect(filterFeatureSections(doc, new Set(["outside_assistants"]))).toContain("Secret help.");
  });

  it("drops it for someone who doesn't", () => {
    const out = filterFeatureSections(doc, new Set());
    expect(out).not.toContain("Secret help.");
    expect(out).toContain("Before.");
    expect(out).toContain("After.");
  });

  it("fails closed on an unclosed block", () => {
    const broken = ["Before.", "::: feature outside_assistants", "Secret help.", "Still secret."].join("\n");
    const out = filterFeatureSections(broken, new Set());
    expect(out).toBe("Before.");
  });

  it("is off for everyone while MCP is switched off", () => {
    vi.stubEnv("MCP_ENABLED", "");
    expect(helpFeaturesFor("system_admin").has("outside_assistants")).toBe(false);
    expect(helpFeaturesFor("team_member").has("outside_assistants")).toBe(false);
  });

  it("is on for system admins only while MCP is admins-only", () => {
    vi.stubEnv("MCP_ENABLED", "true");
    vi.stubEnv("MCP_FOR_EVERYONE", "");
    expect(helpFeaturesFor("system_admin").has("outside_assistants")).toBe(true);
    expect(helpFeaturesFor("company_admin").has("outside_assistants")).toBe(false);
    expect(helpFeaturesFor("team_member").has("outside_assistants")).toBe(false);
  });

  it("shows a client no outside-assistant help anywhere in the real docs", async () => {
    vi.stubEnv("MCP_ENABLED", "true");
    vi.stubEnv("MCP_FOR_EVERYONE", "");
    for (const role of ["team_member", "company_admin", "aims_guide", "portfolio_admin"] as const) {
      const docs = await loadAllHelpFor(role);
      const text = docs.map((d) => d.markdown).join("\n");
      expect(text).not.toMatch(/outside assistant|via Claude|ask every time/i);
    }
    const admin = (await loadAllHelpFor("system_admin")).map((d) => d.markdown).join("\n");
    expect(admin).toMatch(/Connecting an outside assistant/);
  });

  it("finds no broken blocks in the real docs", async () => {
    expect(await helpDocProblems()).toEqual([]);
  });
});
