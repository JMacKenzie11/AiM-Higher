import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Practice } from "./registry";
import type { GateProfile } from "./gate";

// The predicate half of the gate: what happens AFTER the role list
// has said no.
//
// Both modules are dynamically imported inside practiceGate, so they
// are mocked by path here rather than injected.
const mocks = vi.hoisted(() => ({
  leadsAnyFunction: vi.fn(),
  isAimsChampion: vi.fn(),
  companyHasFeature: vi.fn(),
}));

vi.mock("./function-leads", () => ({
  leadsAnyFunction: mocks.leadsAnyFunction,
}));
vi.mock("@/lib/guide/champion", () => ({
  isAimsChampion: mocks.isAimsChampion,
}));
vi.mock("@/lib/subscriptions/service", () => ({
  companyHasFeature: mocks.companyHasFeature,
}));

const { practiceGate } = await import("./gate");

const debrief: Practice = {
  id: "guide-meeting-debrief",
  title: "Debrief a meeting",
  description: "test",
  category: "People",
  promptFile: "prompts/practices/guide-meeting-debrief.md",
  basePromptMode: "full_coach",
  skipSetup: true,
  allowedRoles: ["company_admin", "system_admin", "aims_guide"],
  alsoAimsChampion: true,
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
  mocks.isAimsChampion.mockReset().mockResolvedValue(false);
  mocks.companyHasFeature.mockReset().mockResolvedValue(true);
});

describe("practiceGate · the aims_champion predicate", () => {
  it("admits a team member who holds the seat", async () => {
    mocks.isAimsChampion.mockResolvedValue(true);
    const result = await practiceGate(debrief, member(), "co_acme");
    expect(result.ok).toBe(true);
  });

  it("refuses a team member who does not", async () => {
    const result = await practiceGate(debrief, member(), "co_acme");
    expect(result.ok).toBe(false);
  });

  it("admits a company_admin without asking who the champion is", async () => {
    // The point of the widening. An admin reaches the debrief on
    // their role, so the seat is never consulted — they can already
    // read the meeting it is about.
    const result = await practiceGate(
      debrief,
      member({ role: "company_admin" }),
      "co_acme"
    );
    expect(result.ok).toBe(true);
    expect(mocks.isAimsChampion).not.toHaveBeenCalled();
  });

  it("does not ask about the seat for an agent that never names it", async () => {
    const plain: Practice = { ...debrief, alsoAimsChampion: undefined };
    const result = await practiceGate(plain, member(), "co_acme");
    expect(result.ok).toBe(false);
    expect(mocks.isAimsChampion).not.toHaveBeenCalled();
  });

  it("admits on either predicate when an agent names both", async () => {
    const both: Practice = { ...debrief, alsoFunctionLeads: true };
    mocks.leadsAnyFunction.mockResolvedValue(true);
    expect((await practiceGate(both, member(), "co_acme")).ok).toBe(true);

    mocks.leadsAnyFunction.mockResolvedValue(false);
    mocks.isAimsChampion.mockResolvedValue(true);
    expect((await practiceGate(both, member(), "co_acme")).ok).toBe(true);
  });

  it("still refuses the champion when the company lacks the feature", async () => {
    // The predicate widens WHO, never WHAT the company bought.
    mocks.isAimsChampion.mockResolvedValue(true);
    mocks.companyHasFeature.mockResolvedValue(false);
    const gated: Practice = { ...debrief, feature: "classroom" };
    const result = await practiceGate(gated, member(), "co_acme");
    expect(result.ok).toBe(false);
  });
});
