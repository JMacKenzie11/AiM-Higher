import { describe, expect, it } from "vitest";
import { activeTab, sectionForPath, visibleSections, visibleTabs, SECTIONS } from "./sections";

const ALL = ["execution", "strengths", "classroom"];

describe("sidebar sections", () => {
  it("gives a team member five sections and no AiMS Implementation", () => {
    const s = visibleSections("team_member", ALL);
    expect(s.map((x) => x.label)).toEqual(["Home", "Meeting", "Work", "Plan", "Team"]);
    expect(visibleTabs(s[0], "team_member", ALL).map((t) => t.href)).toEqual(["/dashboard"]);
  });

  it("gives a company admin six, with Settings and AiMS Implementation", () => {
    const s = visibleSections("company_admin", ALL);
    expect(s.map((x) => x.label)).toEqual(["Home", "Meeting", "Work", "Plan", "Team", "Settings"]);
    expect(visibleTabs(s[0], "company_admin", ALL).map((t) => t.href)).toContain("/scorecard");
  });

  it("gives a guide the company sections without Settings", () => {
    expect(visibleSections("aims_guide", ALL).map((x) => x.label)).toEqual(["Home", "Meeting", "Work", "Plan", "Team"]);
  });

  it("drops a section whose module is off, and a tab whose module is off", () => {
    expect(visibleSections("team_member", ["strengths"]).map((x) => x.label)).toEqual([]);
    const team = SECTIONS.find((x) => x.key === "team")!;
    expect(visibleTabs(team, "team_member", ["execution"]).map((t) => t.label)).toEqual(["People"]);
  });

  it("finds the section and tab for a page, including detail pages", () => {
    expect(sectionForPath("/issues")?.key).toBe("work");
    expect(sectionForPath("/plan/priority/abc")?.key).toBe("plan");
    expect(activeTab("/plan/priority/abc", SECTIONS.find((x) => x.key === "plan")!.tabs)?.href).toBe("/plan");
    expect(sectionForPath("/hq")).toBeNull();
    expect(sectionForPath("/strengths/welcome")).toBeNull();
    expect(sectionForPath("/strengths/teams")?.key).toBe("team");
  });
});
