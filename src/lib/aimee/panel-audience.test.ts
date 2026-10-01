import { afterEach, describe, expect, it, vi } from "vitest";
import { panelForEveryone, seesAimeePanel } from "./panel-audience";

describe("who sees Aimee's panel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is system admins only while the switch is off, and off is the default", () => {
    vi.stubEnv("AIMEE_PANEL_FOR_EVERYONE", "");
    expect(panelForEveryone()).toBe(false);
    expect(seesAimeePanel("system_admin")).toBe(true);
    for (const role of ["company_admin", "team_member", "aims_guide", "portfolio_admin"] as const) {
      expect(seesAimeePanel(role), role).toBe(false);
    }
  });

  it("only the exact value true switches it on", () => {
    for (const v of ["1", "yes", "TRUE", "on"]) {
      vi.stubEnv("AIMEE_PANEL_FOR_EVERYONE", v);
      expect(panelForEveryone(), v).toBe(false);
    }
  });

  it("is everyone once switched on", () => {
    vi.stubEnv("AIMEE_PANEL_FOR_EVERYONE", "true");
    for (const role of ["system_admin", "company_admin", "team_member", "aims_guide", "portfolio_admin"] as const) {
      expect(seesAimeePanel(role), role).toBe(true);
    }
  });
});

describe("help pages follow the switch", () => {
  afterEach(() => vi.unstubAllEnvs());
  const doc = ["Shared.", "", "::: panel", "Open Aimee's panel.", ":::", "", "::: no-panel", "Use the ? button.", ":::"].join("\n");

  it("shows the panel text only to people who see the panel", async () => {
    const { filterRoleSections } = await import("@/lib/help/loader");
    vi.stubEnv("AIMEE_PANEL_FOR_EVERYONE", "");
    expect(filterRoleSections(doc, "team_member")).toContain("Use the ? button.");
    expect(filterRoleSections(doc, "team_member")).not.toContain("Open Aimee's panel.");
    expect(filterRoleSections(doc, "system_admin")).toContain("Open Aimee's panel.");
    expect(filterRoleSections(doc, "system_admin")).not.toContain("Use the ? button.");
    vi.stubEnv("AIMEE_PANEL_FOR_EVERYONE", "true");
    expect(filterRoleSections(doc, "team_member")).toContain("Open Aimee's panel.");
    expect(filterRoleSections(doc, "team_member")).not.toContain("Use the ? button.");
  });
});
