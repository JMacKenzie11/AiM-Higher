import { describe, it, expect } from "vitest";
import {
  HubSpotNotConnected,
  localMidnight,
  runHubSpotPull,
  weekWindow,
  type Deal,
  type DealSearch,
  type HubSpotReader,
} from "./hubspot-pull";
import type { HubSpotMapping } from "./mapping";

const TZ = "America/Halifax";
const WEEK = "2026-10-02"; // Saturday Sep 26 to Friday Oct 2

const PIPELINE = {
  id: "default",
  label: "Sales",
  stages: [
    { id: "quoted", label: "Quoted" },
    { id: "closedwon", label: "Closed won" },
  ],
};

// A HubSpot that answers searches with fixed deals and remembers what it
// was asked.
function fake(answer: (s: DealSearch) => Deal[] | { total: number }, pipeline: typeof PIPELINE | null = PIPELINE) {
  const asked: DealSearch[] = [];
  const reader: HubSpotReader = {
    pipeline: async () => pipeline,
    searchDeals: async (s) => {
      asked.push(s);
      const a = answer(s);
      return Array.isArray(a) ? { deals: a, total: a.length } : { deals: [], total: a.total };
    },
  };
  return { reader, asked };
}

const at = (iso: string) => String(new Date(iso).getTime());

const awardedWeekly: HubSpotMapping = {
  connector: "hubspot",
  kind: "weekly",
  recipe: { pipeline_id: "default", measure: "sum_amount", date: "entered_stage", stage_id: "closedwon" },
};

describe("the week, as instants", () => {
  it("starts at the company's own Saturday midnight", () => {
    // Halifax is UTC-3 in late September.
    expect(new Date(localMidnight("2026-09-26", TZ)).toISOString()).toBe("2026-09-26T03:00:00.000Z");
    const [start, end] = weekWindow(WEEK, TZ);
    expect(new Date(start).toISOString()).toBe("2026-09-26T03:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-10-03T03:00:00.000Z");
  });

  it("follows the clocks changing", () => {
    // Halifax goes back an hour on Sunday Nov 1 2026: the week ending
    // Nov 6 starts at UTC-3 and ends at UTC-4.
    const [start, end] = weekWindow("2026-11-06", TZ);
    expect(new Date(start).toISOString()).toBe("2026-10-31T03:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-11-07T04:00:00.000Z");
  });
});

describe("a weekly HubSpot pull", () => {
  it("adds up the deals that entered Closed won in the week, by HubSpot's own date", async () => {
    const { reader, asked } = fake(() => [
      { amount_in_home_currency: "40000", hs_v2_date_entered_closedwon: at("2026-09-28T15:00:00Z") },
      { amount_in_home_currency: "12500.50", hs_v2_date_entered_closedwon: at("2026-10-02T20:00:00Z") },
      { amount_in_home_currency: null, hs_v2_date_entered_closedwon: at("2026-09-30T12:00:00Z") },
    ]);
    const d = await runHubSpotPull(reader, awardedWeekly, WEEK, TZ);
    expect(d).toMatchObject({ outcome: "written", value: 52500.5 });
    if (d.outcome !== "written") return;
    expect(d.detail).toMatchObject({ deals_counted: 3, deals_without_amount: 1, deals_outside_week: 0 });
    // Searched in the pipeline, between the company's own Saturday midnights.
    expect(asked[0].filters).toEqual([
      { propertyName: "pipeline", operator: "EQ", value: "default" },
      { propertyName: "hs_v2_date_entered_closedwon", operator: "GTE", value: String(weekWindow(WEEK, TZ)[0]) },
      { propertyName: "hs_v2_date_entered_closedwon", operator: "LT", value: String(weekWindow(WEEK, TZ)[1]) },
    ]);
  });

  it("puts 11pm Friday in Halifax in Friday's week, and leaves out a deal in another week", async () => {
    const { reader } = fake(() => [
      // Fri Oct 2 23:00 in Halifax is Sat Oct 3 02:00 UTC: still this week.
      { amount_in_home_currency: "100", hs_v2_date_entered_closedwon: at("2026-10-03T02:00:00Z") },
      // Sat Oct 3 10:00 in Halifax: next week, though a search returned it.
      { amount_in_home_currency: "999", hs_v2_date_entered_closedwon: at("2026-10-03T13:00:00Z") },
    ]);
    const d = await runHubSpotPull(reader, awardedWeekly, WEEK, TZ);
    expect(d).toMatchObject({ outcome: "written", value: 100, detail: { deals_counted: 1, deals_outside_week: 1 } });
  });

  it("counts deals created in the week", async () => {
    const created: HubSpotMapping = {
      connector: "hubspot",
      kind: "weekly",
      recipe: { pipeline_id: "default", measure: "count", date: "created" },
    };
    const { reader, asked } = fake(() => [
      { createdate: "2026-09-29T10:00:00Z" },
      { createdate: "2026-10-01T10:00:00Z", amount_in_home_currency: "5" },
    ]);
    expect(await runHubSpotPull(reader, created, WEEK, TZ)).toMatchObject({ outcome: "written", value: 2 });
    expect(asked[0].filters[1].propertyName).toBe("createdate");
  });
});

describe("a snapshot HubSpot pull", () => {
  it("adds awarded at full amount and quoted at its weighted amount", async () => {
    const factored: HubSpotMapping = {
      connector: "hubspot",
      kind: "snapshot",
      recipe: {
        pipeline_id: "default",
        parts: [
          { stage_ids: ["closedwon"], value: "amount" },
          { stage_ids: ["quoted"], value: "weighted_amount" },
        ],
      },
    };
    const { reader, asked } = fake((s) =>
      s.properties[0] === "amount_in_home_currency"
        ? [{ amount_in_home_currency: "100000" }, { amount_in_home_currency: "50000" }]
        : [{ hs_projected_amount_in_home_currency: "30000" }, { hs_projected_amount_in_home_currency: "" }]
    );
    const d = await runHubSpotPull(reader, factored, WEEK, TZ);
    expect(d).toMatchObject({ outcome: "written", value: 180000 });
    if (d.outcome !== "written") return;
    expect(d.detail.parts).toEqual([
      { stage_ids: ["closedwon"], value: "amount", deals: 2, deals_without_amount: 0, sum: 150000 },
      { stage_ids: ["quoted"], value: "weighted_amount", deals: 2, deals_without_amount: 1, sum: 30000 },
    ]);
    expect(asked[1].filters[1]).toEqual({ propertyName: "dealstage", operator: "IN", values: ["quoted"] });
  });
});

describe("a HubSpot pull that cannot be trusted records nothing", () => {
  it("fails when a stage it counts is gone, rather than reading a zero", async () => {
    const { reader } = fake(() => [], { ...PIPELINE, stages: [{ id: "quoted", label: "Quoted" }] });
    expect(await runHubSpotPull(reader, awardedWeekly, WEEK, TZ)).toMatchObject({
      outcome: "failed",
      reason: "hubspot_stage_missing",
      detail: { stage_ids: ["closedwon"] },
    });
  });

  it("fails when the pipeline is gone", async () => {
    const { reader } = fake(() => [], null);
    expect(await runHubSpotPull(reader, awardedWeekly, WEEK, TZ)).toMatchObject({ outcome: "failed", reason: "hubspot_stage_missing" });
  });

  it("fails when more deals match than the search will return", async () => {
    const { reader } = fake(() => ({ total: 12_000 }));
    expect(await runHubSpotPull(reader, awardedWeekly, WEEK, TZ)).toMatchObject({ outcome: "failed", reason: "hubspot_too_many" });
  });

  it("says the company has no key, and passes on HubSpot's own words otherwise", async () => {
    const noKey: HubSpotReader = {
      pipeline: async () => {
        throw new HubSpotNotConnected();
      },
      searchDeals: async () => ({ deals: [], total: 0 }),
    };
    expect(await runHubSpotPull(noKey, awardedWeekly, WEEK, TZ)).toMatchObject({ outcome: "failed", reason: "hubspot_not_connected" });
    const refused: HubSpotReader = {
      pipeline: async () => {
        throw new Error("HubSpot refused the pipeline read (401): Authentication credentials not found.");
      },
      searchDeals: async () => ({ deals: [], total: 0 }),
    };
    expect(await runHubSpotPull(refused, awardedWeekly, WEEK, TZ)).toMatchObject({
      outcome: "failed",
      reason: "hubspot_unreachable",
      detail: { error: expect.stringContaining("401") },
    });
  });
});
