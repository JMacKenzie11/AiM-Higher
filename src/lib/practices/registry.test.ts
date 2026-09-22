import { describe, it, expect } from "vitest";
import { PRACTICES } from "./registry";

// What the registry promises about who can reach what.
//
// These are one-line facts that are easy to change by accident and
// invisible when wrong: an agent that quietly loses its allowedRoles
// becomes available to every team member in every company, and
// nothing about the picker looks different to the person who made
// the change.

const PEOPLE_AGENT_ROLES = ["company_admin", "system_admin", "aims_guide"];

describe("the People agents", () => {
  const people = PRACTICES.filter((p) => p.category === "People");

  it("are the two we expect", () => {
    expect(people.map((p) => p.id).sort()).toEqual([
      "functional-chart-builder",
      "role-description",
    ]);
  });

  // Both reshape how a company is organised — one draws the chart,
  // the other writes what a seat is held to. Neither is a thing a
  // team member does, and they should not drift apart on who can
  // reach them.
  it("admit the same three roles, and no others", () => {
    for (const p of people) {
      expect([...(p.allowedRoles ?? [])].sort(), p.id).toEqual(
        [...PEOPLE_AGENT_ROLES].sort()
      );
    }
  });

  it("never admit a team member", () => {
    for (const p of people) {
      expect(p.allowedRoles ?? [], p.id).not.toContain("team_member");
    }
  });
});

describe("the Role Description Creator", () => {
  const rd = PRACTICES.find((p) => p.id === "role-description")!;

  // It was described as feature-gated for a while without being one.
  // The card it writes to only renders for companies with
  // role_descriptions, so without this a company could run the
  // agent, press Save, and have the document land somewhere they
  // cannot see.
  it("is gated on the same feature as the surface its output lands on", () => {
    expect(rd.feature).toBe("role_descriptions");
  });

  it("declares the two tools it cannot work without", () => {
    expect([...(rd.tools ?? [])].sort()).toEqual([
      "get_foundation",
      "list_functions",
    ]);
  });
});
