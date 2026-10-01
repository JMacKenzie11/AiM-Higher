import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { COMPANY_FEATURES, VALID_COMPANY_FEATURES } from "@/lib/companies/features";
import { PRACTICES } from "./registry";
import { practiceFeatureGate } from "./gate";
import { TEST_AGENT_ID, TEST_ONLY_FEATURE } from "./test-agent";

// THE TEST-ONLY AGENT NEVER REACHES A REAL COMPANY (2026-09-29).
//
// It is gated on a feature only seed:e2e sets. So: the agent carries
// that feature, the gate refuses a company without it, and the feature
// is nowhere a person could switch it on.

describe("the test-only agent", () => {
  const agent = PRACTICES.find((p) => p.id === TEST_AGENT_ID)!;

  it("exists in code, so the revert test has a code default", () => {
    expect(agent).toBeTruthy();
  });

  it("needs the e2e_testing feature, and is refused to a company without it", () => {
    expect(agent.feature).toBe(TEST_ONLY_FEATURE);
    expect(practiceFeatureGate(agent, false).ok).toBe(false);
    expect(practiceFeatureGate(agent, true).ok).toBe(true);
  });

  it("uses a feature that is not in the settings catalogue, so no screen can switch it on", () => {
    expect(COMPANY_FEATURES.map((f) => f.value)).not.toContain(TEST_ONLY_FEATURE);
    expect(VALID_COMPANY_FEATURES.has(TEST_ONLY_FEATURE)).toBe(false);
  });
});
