import { describe, it, expect } from "vitest";
import { practiceRoleGate, type GateProfile } from "./gate";
import type { Practice } from "./registry";

// Role gate for launching a practice. Covers:
//   - allowedRoles absent → open to everyone
//   - allowedRoles present → role in list is admitted, out-of-list denied
//   - aims_guide additionally needs an assignment to the target company
//
// The gate is the security boundary for direct-launch URLs
// (/ask-aimee/new?practice=X) — a team member following a shared
// link to a role-gated practice should hit the deny path.

const gatedPractice: Practice = {
  id: "chart-builder",
  title: "Functional Chart Builder",
  description: "test",
  category: "Structure",
  promptFile: "prompts/practices/functional-chart-builder.md",
  basePromptMode: "voice_only",
  skipSetup: true,
  allowedRoles: ["company_admin", "system_admin", "aims_guide"],
};

const openPractice: Practice = {
  id: "hard-conversation",
  title: "Hard conversation",
  description: "test",
  category: "Communication",
  promptFile: "prompts/practices/prepare-a-hard-conversation.md",
  basePromptMode: "full_coach",
  skipSetup: false,
};

function profileFor(overrides: Partial<GateProfile>): GateProfile {
  return {
    id: "p1",
    role: "team_member",
    company_id: "co_acme",
    guide_company_ids: [],
    ...overrides,
  };
}

describe("practiceRoleGate", () => {
  it("admits everyone when allowedRoles is absent", () => {
    expect(
      practiceRoleGate(openPractice, profileFor({ role: "team_member" }), "co_acme")
    ).toEqual({ ok: true });
  });

  it("denies a team_member on a role-gated practice", () => {
    const res = practiceRoleGate(
      gatedPractice,
      profileFor({ role: "team_member" }),
      "co_acme"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/isn't available/i);
  });

  it("admits a company_admin whose role is in the list", () => {
    expect(
      practiceRoleGate(
        gatedPractice,
        profileFor({ role: "company_admin" }),
        "co_acme"
      )
    ).toEqual({ ok: true });
  });

  it("admits a system_admin regardless of company", () => {
    expect(
      practiceRoleGate(
        gatedPractice,
        profileFor({ role: "system_admin", company_id: null }),
        "co_anything"
      )
    ).toEqual({ ok: true });
  });

  it("admits an aims_guide when the scoped company is in their assignments", () => {
    const res = practiceRoleGate(
      gatedPractice,
      profileFor({
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_acme"],
      }),
      "co_acme"
    );
    expect(res.ok).toBe(true);
  });

  it("denies an aims_guide on a company they aren't assigned to", () => {
    // Guide role passes the allowedRoles check, but the second
    // check (isAdminForCompany) requires the assignment. Off-
    // caseload guides fall to the same denial path as team members.
    const res = practiceRoleGate(
      gatedPractice,
      profileFor({
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_meridian"],
      }),
      "co_acme"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/aren't assigned/i);
  });
});
