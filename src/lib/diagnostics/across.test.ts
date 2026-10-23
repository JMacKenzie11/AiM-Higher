import { describe, it, expect } from "vitest";
import { acrossClients, type AcrossInput } from "./across";
import { assembleReadout } from "./readout";
import { readoutBundle } from "./readout.fixture";

// The fixture's readout measures 6 hours back and projects 16.2 more,
// against a guarantee of 3.
const published = (decision: string, industry: string | null, source: string | null, overrides = {}): AcrossInput => ({
  published_at: "2026-10-22T12:00:00Z",
  published_readout: assembleReadout(readoutBundle(overrides), "2026-10-22"),
  decision,
  industry,
  source,
});
const running = (industry: string | null, source: string | null): AcrossInput => ({ published_at: null, published_readout: null, decision: "pending", industry, source });

describe("across clients", () => {
  const rows = [
    published("sprint", "Manufacturing", "referral"),
    published("declined", "manufacturing", "lift", { guarantee_hours: 8 }),
    published("pending", null, null),
    running("Construction", "referral"),
  ];
  const view = acrossClients(rows);

  it("counts only published readouts toward the hours, the guarantee and the decisions", () => {
    expect(view.all).toMatchObject({ running: 1, readouts: 3, guaranteeMet: 2, sprint: 1, declined: 1, pending: 1, averageMeasured: 6, averageProjected: 16.2 });
  });

  it("groups by industry whatever the case, and by source with its label", () => {
    expect(view.byIndustry.map((r) => [r.label, r.readouts, r.running])).toEqual([
      ["Manufacturing", 2, 0],
      ["Not recorded", 1, 0],
      ["Construction", 0, 1],
    ]);
    expect(view.bySource.find((r) => r.label === "Referral")).toMatchObject({ readouts: 1, running: 1, sprint: 1 });
    expect(view.bySource.find((r) => r.label === "LIFT")).toMatchObject({ readouts: 1, guaranteeMet: 0, declined: 1 });
  });

  it("leaves the averages empty when nothing is published", () => {
    expect(acrossClients([running(null, null)]).all).toMatchObject({ readouts: 0, averageMeasured: null, averageProjected: null });
  });

  it("ignores a published flag with no readout behind it", () => {
    expect(acrossClients([{ ...running(null, null), published_at: "2026-10-22T12:00:00Z" }]).all.readouts).toBe(0);
  });
});
