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
    expect(helpFeaturesFor("system_admin", { subdomain: "@", companyAssistantsOn: true }).has("outside_assistants")).toBe(false);
    expect(helpFeaturesFor("team_member", { subdomain: "@", companyAssistantsOn: true }).has("outside_assistants")).toBe(false);
  });

  it("is on for every role but portfolio admins", () => {
    vi.stubEnv("MCP_ENABLED", "true");
    const on = { subdomain: "@", companyAssistantsOn: true };
    for (const role of ["system_admin", "company_admin", "aims_guide", "team_member"] as const) {
      expect(helpFeaturesFor(role, on).has("outside_assistants")).toBe(true);
    }
    expect(helpFeaturesFor("portfolio_admin", on).has("outside_assistants")).toBe(false);
  });

  it("shows the switched-off help instead where no company of theirs has it on", () => {
    vi.stubEnv("MCP_ENABLED", "true");
    const off = { subdomain: "@", companyAssistantsOn: false };
    expect([...helpFeaturesFor("aims_guide", off)]).toEqual(["ai_apps_off"]);
    expect([...helpFeaturesFor("system_admin", off)]).toEqual(["outside_assistants"]);
    expect([...helpFeaturesFor("portfolio_admin", off)]).toEqual([]);
  });

  it("needs the viewer's company switch, and the instance", () => {
    vi.stubEnv("MCP_ENABLED", "true");
    vi.stubEnv("MCP_INSTANCES", "@");
    expect(helpFeaturesFor("team_member", { subdomain: "@", companyAssistantsOn: false }).has("outside_assistants")).toBe(false);
    expect(helpFeaturesFor("team_member", { subdomain: "@", companyAssistantsOn: true }).has("outside_assistants")).toBe(true);
    expect(helpFeaturesFor("team_member", { subdomain: "promiseone", companyAssistantsOn: true }).has("outside_assistants")).toBe(false);
    // A system admin needs no company switch to read the help.
    expect(helpFeaturesFor("system_admin", { subdomain: "@", companyAssistantsOn: false }).has("outside_assistants")).toBe(true);
  });

  it("shows no outside-assistant help where it is off, in the real docs", async () => {
    vi.stubEnv("MCP_ENABLED", "true");
    const off = { subdomain: "@", companyAssistantsOn: false };
    for (const role of ["team_member", "company_admin", "aims_guide"] as const) {
      const text = (await loadAllHelpFor(role, off)).map((d) => d.markdown).join("\n");
      expect(text).not.toMatch(/outside assistant|Connect Claude|Connect ChatGPT|api\/mcp|ask every time/i);
    }
    const viewer = { subdomain: "@", companyAssistantsOn: true };
    for (const role of ["portfolio_admin"] as const) {
      const docs = await loadAllHelpFor(role, viewer);
      const text = docs.map((d) => d.markdown).join("\n");
      expect(text).not.toMatch(/outside assistant|Connect Claude|Connect ChatGPT|api\/mcp|ask every time/i);
    }
    const admin = (await loadAllHelpFor("system_admin", viewer)).map((d) => d.markdown).join("\n");
    expect(admin).toMatch(/Your connected AI apps/);
  });

  it("finds no broken blocks in the real docs", async () => {
    expect(await helpDocProblems()).toEqual([]);
  });
});
