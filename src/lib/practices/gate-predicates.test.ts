import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Practice } from "./registry";
import type { GateProfile } from "./gate";

// The predicate half of the gate: what happens AFTER the role list
// has said no. The function_lead predicate is the only one since the
// AiMS champion seat was retired (0329).
//
// The module is dynamically imported inside practiceGate, so it is
// mocked by path here rather than injected.
const mocks = vi.hoisted(() => ({
  leadsAnyFunction: vi.fn(),
  companyHasFeature: vi.fn(),
}));

vi.mock("./function-leads", () => ({
  leadsAnyFunction: mocks.leadsAnyFunction,
}));
vi.mock("@/lib/subscriptions/service", () => ({
  companyHasFeature: mocks.companyHasFeature,
}));

const { practiceGate } = await import("./gate");

const adminsOnly: Practice = {
  id: "guide-meeting-debrief",
  title: "Debrief a meeting",
  description: "test",
  category: "People",
  promptFile: "prompts/practices/guide-meeting-debrief.md",
  basePromptMode: "full_coach",
  skipSetup: true,
  allowedRoles: ["company_admin", "system_admin", "aims_guide"],
};

function member(overrides: Partial<GateProfile> = {}): GateProfile {
  return {
    id: "p_member",
    role: "team_member",
    company_id: "co_acme",
    guide_company_ids: [],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.leadsAnyFunction.mockReset().mockResolvedValue(false);
  mocks.companyHasFeature.mockReset().mockResolvedValue(true);
});

describe("practiceGate · predicates", () => {
  it("refuses a team member when the agent names no predicate", async () => {
    const result = await practiceGate(adminsOnly, member(), "co_acme");
    expect(result.ok).toBe(false);
    expect(mocks.leadsAnyFunction).not.toHaveBeenCalled();
  });

  it("admits a team member who leads a function when the agent names function leads", async () => {
    mocks.leadsAnyFunction.mockResolvedValue(true);
    const leads: Practice = { ...adminsOnly, alsoFunctionLeads: true };
    expect((await practiceGate(leads, member(), "co_acme")).ok).toBe(true);
  });

  it("admits a company_admin without asking about function leads", async () => {
    const leads: Practice = { ...adminsOnly, alsoFunctionLeads: true };
    const result = await practiceGate(leads, member({ role: "company_admin" }), "co_acme");
    expect(result.ok).toBe(true);
    expect(mocks.leadsAnyFunction).not.toHaveBeenCalled();
  });

  it("still refuses a lead when the company lacks the feature", async () => {
    // The predicate widens WHO, never WHAT the company bought.
    mocks.leadsAnyFunction.mockResolvedValue(true);
    mocks.companyHasFeature.mockResolvedValue(false);
    const gated: Practice = { ...adminsOnly, alsoFunctionLeads: true, feature: "classroom" };
    const result = await practiceGate(gated, member(), "co_acme");
    expect(result.ok).toBe(false);
  });
});
