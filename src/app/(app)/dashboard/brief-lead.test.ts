import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/dashboard/brief", () => ({ getLatestDashboardBrief: vi.fn(), getOrGenerateDashboardBrief: vi.fn() }));

import { splitLead } from "./BriefSection";

describe("splitLead: the brief's first sentence leads", () => {
  it("splits at the first sentence end", () => {
    expect(splitLead("A solid week. Six kept on time. More to do.")).toEqual(["A solid week.", "Six kept on time. More to do."]);
  });
  it("keeps the whole brief as the lead when there is one sentence", () => {
    expect(splitLead("Only one sentence here.")).toEqual(["Only one sentence here.", ""]);
  });
  it("does not split inside a number", () => {
    expect(splitLead("Q4 is at 62.5 percent so far. Good.")).toEqual(["Q4 is at 62.5 percent so far.", "Good."]);
  });
});
