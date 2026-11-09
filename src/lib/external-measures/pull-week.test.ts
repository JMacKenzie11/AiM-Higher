import { describe, it, expect } from "vitest";
import { defaultPullWeek } from "./pull-week";
import type { ExternalMapping } from "./mapping";

// The week Pull now targets when nobody picked one. The drawer and the
// grid row's menu both ask this, so the two buttons pull the same week.

const WEEKS = ["2026-10-23", "2026-10-30", "2026-11-06"];

const as = (m: unknown) => m as ExternalMapping;
const sheetWeekly = as({
  connector: "google_sheet",
  kind: "weekly",
  recipe: { file_id: "f", tab: "t", key_column: "k", value_column: "v" },
});
const sheetSnapshot = as({
  connector: "google_sheet",
  kind: "snapshot",
  recipe: { file_id: "f", tab: "t", cell: "B7" },
});
const sheetSnapshotDated = as({
  connector: "google_sheet",
  kind: "snapshot",
  recipe: { file_id: "f", tab: "t", cell: "B7", freshness: { tab: "t", cell: "A1" } },
});
const hubspotWeekly = as({
  connector: "hubspot",
  kind: "weekly",
  recipe: { pipeline_id: "p", measure: "count", date: "created" },
});
const hubspotSnapshot = as({
  connector: "hubspot",
  kind: "snapshot",
  recipe: { pipeline_id: "p", parts: [] },
});

describe("defaultPullWeek", () => {
  it("pulls this week for a week-keyed sheet and a plain snapshot", () => {
    expect(defaultPullWeek(sheetWeekly, WEEKS)).toBe("2026-11-06");
    expect(defaultPullWeek(sheetSnapshot, WEEKS)).toBe("2026-11-06");
    expect(defaultPullWeek(hubspotSnapshot, WEEKS)).toBe("2026-11-06");
  });

  it("pulls the last completed week for a dated snapshot and a HubSpot weekly total", () => {
    expect(defaultPullWeek(sheetSnapshotDated, WEEKS)).toBe("2026-10-30");
    expect(defaultPullWeek(hubspotWeekly, WEEKS)).toBe("2026-10-30");
  });

  it("falls back to the only week there is", () => {
    expect(defaultPullWeek(hubspotWeekly, ["2026-11-06"])).toBe("2026-11-06");
    expect(defaultPullWeek(null, [])).toBe("");
  });
});
