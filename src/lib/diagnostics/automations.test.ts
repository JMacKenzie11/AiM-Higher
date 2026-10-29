import { describe, expect, it } from "vitest";
import { automationsFromDiagnostic, sortAutomations } from "./automations";

describe("automationsFromDiagnostic", () => {
  const roadmap = [
    { title: "Job costing report", target_week: 4, champion: "Marcus T." },
    { title: "Purchase order chasing", target_week: 8, champion: "" },
  ];

  it("starts the first win live once in use, and each next win planned with its champion", () => {
    expect(automationsFromDiagnostic({ title: "Quote first draft", in_use_from: "2026-10-12" }, roadmap, [])).toEqual([
      { title: "Quote first draft", stage: "live", goes_live: "2026-10-12", champion: null },
      { title: "Job costing report", stage: "planned", goes_live: null, champion: "Marcus T." },
      { title: "Purchase order chasing", stage: "planned", goes_live: null, champion: null },
    ]);
  });

  it("has a first win not yet in use being built", () => {
    expect(automationsFromDiagnostic({ title: "Quote first draft", in_use_from: null }, [], [])[0].stage).toBe("building");
  });

  it("skips a title the client already has, whatever its case", () => {
    const added = automationsFromDiagnostic({ title: "Quote first draft", in_use_from: null }, roadmap, ["quote FIRST draft ", "Job costing report"]);
    expect(added.map((a) => a.title)).toEqual(["Purchase order chasing"]);
  });

  it("adds nothing when there is no first win and no roadmap", () => {
    expect(automationsFromDiagnostic(null, [], [])).toEqual([]);
  });
});

describe("sortAutomations", () => {
  it("lists live first, then testing, building, planned, paused; soonest go-live first, undated last", () => {
    const rows = [
      { title: "p", stage: "paused" as const, goes_live: "2026-01-01", created_at: "1" },
      { title: "b-late", stage: "building" as const, goes_live: "2026-12-01", created_at: "1" },
      { title: "b-none", stage: "building" as const, goes_live: null, created_at: "1" },
      { title: "b-soon", stage: "building" as const, goes_live: "2026-11-01", created_at: "1" },
      { title: "l", stage: "live" as const, goes_live: null, created_at: "1" },
      { title: "t", stage: "testing" as const, goes_live: null, created_at: "1" },
      { title: "pl", stage: "planned" as const, goes_live: null, created_at: "1" },
    ];
    expect(sortAutomations(rows).map((r) => r.title)).toEqual(["l", "t", "b-soon", "b-late", "b-none", "pl", "p"]);
  });
});
