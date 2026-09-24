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

  // Deliberately ungated. role_descriptions gates the surfaces this
  // agent replaced, and that flag is going off fleet-wide; carrying
  // it here would take the agent down with them. Who can reach it is
  // a question about the person, not the company's packaging.
  it("is not gated on a company feature", () => {
    expect(rd.feature).toBeUndefined();
  });

  // The seat's Lead is usually a team_member, so no list of platform
  // roles can express who should reach this.
  it("admits whoever heads up a function", () => {
    expect(rd.alsoFunctionLeads).toBe(true);
  });

  it("declares the tools it cannot work without", () => {
    expect([...(rd.tools ?? [])].sort()).toEqual([
      "get_foundation",
      // Registered only when the conversation is revising something,
      // so a fresh interview never sees it. Declared here all the
      // same: the registry says what the agent may use, and the
      // builder decides what it gets this time.
      "get_role_description",
      "list_functions",
    ]);
  });
});

describe("the meeting debrief agent", () => {
  const debrief = PRACTICES.find((p) => p.id === "guide-meeting-debrief")!;

  // Aimee reaches out first for this one. The opener has to name
  // something that actually happened in the meeting, which means a
  // generated turn that has read the summary — a scripted line here
  // would be "your meeting was analyzed" one screen further in.
  it("generates its opener rather than scripting one", () => {
    expect(debrief.firstTurn).toBe("generate");
    expect(debrief.scriptedOpener).toBeUndefined();
  });

  // The champion is frequently a team_member. The role list alone
  // would refuse the person the notification was addressed to.
  it("admits the champion on top of the three admin roles", () => {
    expect(debrief.alsoAimsChampion).toBe(true);
    expect([...(debrief.allowedRoles ?? [])].sort()).toEqual([
      "aims_guide",
      "company_admin",
      "system_admin",
    ]);
  });

  // The seat routes attention; it is not an access boundary. An
  // admin can already open the meeting the debrief is about.
  it("does not fence company admins out behind the seat", () => {
    expect(debrief.allowedRoles).toContain("company_admin");
  });

  it("reads the meeting, and nothing that writes", () => {
    expect([...(debrief.tools ?? [])]).toEqual(["get_meeting_debrief"]);
  });

  // Not gated on a company feature. A company without transcripts
  // never has a meeting analysed, so no nudge is ever raised and the
  // agent simply never comes up — a flag would be a second way to
  // say the same thing, and a second thing to keep true.
  it("is not gated on a company feature", () => {
    expect(debrief.feature).toBeUndefined();
  });
});
