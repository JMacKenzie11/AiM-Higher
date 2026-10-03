import { describe, it, expect } from "vitest";

import {
  canBackfill,
  describeMapping,
  extractFileId,
  isCellRef,
  missingMappingFields,
  parseMapping,
} from "./mapping";

// Every mapping is {connector, kind, pull_day?, recipe} (0258).
const weekly = (recipe: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  connector: "google_sheet",
  kind: "weekly",
  ...extra,
  recipe,
});
const snapshot = (recipe: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  connector: "google_sheet",
  kind: "snapshot",
  ...extra,
  recipe,
});

describe("parseMapping", () => {
  it("reads a weekly sheet mapping, keeping its pull day", () => {
    expect(
      parseMapping(weekly({ file_id: "F", tab: "Data", key_column: "Week Ending", value_column: "Shipped" }, { pull_day: "Mon" }))
    ).toEqual({
      connector: "google_sheet",
      kind: "weekly",
      pull_day: "mon",
      recipe: { file_id: "F", tab: "Data", key_column: "Week Ending", value_column: "Shipped" },
    });
  });

  it("reads a snapshot mapping, with and without freshness", () => {
    expect(parseMapping(snapshot({ file_id: "F", tab: "S", cell: "B7" }))).toEqual(
      snapshot({ file_id: "F", tab: "S", cell: "B7" })
    );
    expect(
      parseMapping(snapshot({ file_id: "F", tab: "S", cell: "B7", freshness: { tab: "S", cell: "B2" } }))
    ).toEqual(snapshot({ file_id: "F", tab: "S", cell: "B7", freshness: { tab: "S", cell: "B2" } }));
  });

  it("trims, because a pasted tab name carries a trailing space", () => {
    expect(parseMapping(snapshot({ file_id: " F ", tab: " Summary ", cell: " B7 " }))).toEqual(
      snapshot({ file_id: "F", tab: "Summary", cell: "B7" })
    );
  });

  it("refuses HALF a freshness field", () => {
    // Worse than none: it reads as a check that is running when it
    // is not, and the client believes stale numbers are being
    // declined when they are being written.
    expect(parseMapping(snapshot({ file_id: "F", tab: "S", cell: "B7", freshness: { tab: "S" } }))).toBeNull();
  });

  it("refuses a mapping missing any required field", () => {
    expect(parseMapping(weekly({ file_id: "F", tab: "D" }))).toBeNull();
    expect(parseMapping(weekly({ file_id: "F", tab: "D", key_column: "W" }))).toBeNull();
    expect(parseMapping(snapshot({ file_id: "F", tab: "S" }))).toBeNull();
    expect(parseMapping(weekly({ tab: "D", key_column: "W", value_column: "V" }))).toBeNull();
    expect(parseMapping({ connector: "google_sheet", kind: "weekly" })).toBeNull();
  });

  it("refuses an empty string, which is not the same as a value", () => {
    expect(parseMapping(snapshot({ file_id: "F", tab: "  ", cell: "B7" }))).toBeNull();
  });

  it("refuses a connector it does not know, which is how phase 4 stays deliberate", () => {
    expect(parseMapping({ connector: "hubspot", kind: "snapshot", recipe: { file_id: "F", tab: "D", cell: "B1" } })).toBeNull();
    expect(parseMapping({ kind: "snapshot", recipe: { file_id: "F", tab: "D", cell: "B1" } })).toBeNull();
  });

  it("refuses the shape from before 0258, which the migration translates", () => {
    expect(parseMapping({ kind: "week_keyed", file_id: "F", tab: "D", key_column: "W", value_column: "V" })).toBeNull();
    expect(parseMapping({ kind: "snapshot", file_id: "F", tab: "S", cell: "B7" })).toBeNull();
  });

  it("refuses an unknown pull day rather than defaulting it", () => {
    expect(parseMapping(snapshot({ file_id: "F", tab: "S", cell: "B7" }, { pull_day: "monday" }))).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    expect(parseMapping(null)).toBeNull();
    expect(parseMapping(undefined)).toBeNull();
    expect(parseMapping("weekly")).toBeNull();
    expect(parseMapping([])).toBeNull();
    expect(parseMapping(7)).toBeNull();
  });
});

describe("canBackfill", () => {
  it("backfills a weekly number and never a snapshot", () => {
    expect(canBackfill(parseMapping(weekly({ file_id: "F", tab: "D", key_column: "W", value_column: "V" }))!)).toBe(true);
    expect(canBackfill(parseMapping(snapshot({ file_id: "F", tab: "S", cell: "B7" }))!)).toBe(false);
  });
});

describe("missingMappingFields", () => {
  it("names the empty boxes, by the form's own labels", () => {
    expect(missingMappingFields(weekly({ file_id: "F" }))).toEqual(["Tab name", "Key column heading", "Value column heading"]);
    expect(missingMappingFields(snapshot({ file_id: "F", tab: "S", freshness: { tab: "S" } }))).toEqual(["Cell", "Freshness cell"]);
  });
});

describe("isCellRef", () => {
  it("accepts a plain cell", () => {
    expect(isCellRef("B7")).toBe(true);
    expect(isCellRef("aa12")).toBe(true);
  });

  it("refuses a range, an anchor, or a tab prefix", () => {
    // These are concatenated into a Sheets range, so anything that
    // is not plainly one cell is refused before it is sent.
    expect(isCellRef("B7:C9")).toBe(false);
    expect(isCellRef("$B$7")).toBe(false);
    expect(isCellRef("Summary!B7")).toBe(false);
    expect(isCellRef("B")).toBe(false);
    expect(isCellRef("7")).toBe(false);
    expect(isCellRef("B0")).toBe(false);
  });
});

describe("extractFileId", () => {
  it("pulls the id out of a pasted URL", () => {
    expect(
      extractFileId(
        "https://docs.google.com/spreadsheets/d/1aBcD_efGhIjKlMnOpQrStUvWxYz012345/edit#gid=0"
      )
    ).toBe("1aBcD_efGhIjKlMnOpQrStUvWxYz012345");
  });

  it("passes a bare id through", () => {
    expect(extractFileId("1aBcD_efGhIjKlMnOpQrStUvWxYz012345")).toBe(
      "1aBcD_efGhIjKlMnOpQrStUvWxYz012345"
    );
  });

  it("refuses a URL it does not understand rather than guessing", () => {
    expect(extractFileId("https://docs.google.com/document/d/abc/edit")).toBeNull();
    expect(extractFileId("the shipping sheet")).toBeNull();
    expect(extractFileId("")).toBeNull();
  });
});

describe("describeMapping", () => {
  it("says what a weekly mapping does in words", () => {
    const words = describeMapping(
      parseMapping(weekly({ file_id: "F", tab: "Dashboard Data", key_column: "Week Ending", value_column: "Shipped" }))!
    );
    expect(words).toContain("Dashboard Data");
    expect(words).toContain("Week Ending");
    expect(words).toContain("Shipped");
  });

  it("describes a plain snapshot without mentioning freshness at all", () => {
    // The form has no freshness field, so naming its absence only
    // raises a question about a control the reader cannot find.
    const words = describeMapping(parseMapping(snapshot({ file_id: "F", tab: "S", cell: "b7" }))!);
    expect(words).toContain("B7");
    expect(words).not.toMatch(/freshness/i);
  });

  it("names the freshness cell when there is one", () => {
    const words = describeMapping(
      parseMapping(snapshot({ file_id: "F", tab: "S", cell: "B7", freshness: { tab: "Meta", cell: "b2" } }))!
    );
    expect(words).toContain("B2");
    expect(words).toContain("Meta");
  });
});

describe("HubSpot recipes (phase 4)", () => {
  const hs = (kind: string, recipe: Record<string, unknown>) => ({ connector: "hubspot", kind, recipe });

  it("reads a weekly recipe dated by a stage, keeping the names for the description", () => {
    const m = parseMapping(
      hs("weekly", { pipeline_id: "default", measure: "sum_amount", date: "entered_stage", stage_id: "closedwon", pipeline_label: "Sales", stage_labels: { closedwon: "Closed won" } })
    );
    expect(m).toEqual({
      connector: "hubspot",
      kind: "weekly",
      recipe: { pipeline_id: "default", measure: "sum_amount", date: "entered_stage", stage_id: "closedwon", pipeline_label: "Sales", stage_labels: { closedwon: "Closed won" } },
    });
    expect(describeMapping(m!)).toBe('Add up the amounts of the deals in the "Sales" pipeline that entered "Closed won" in the week.');
    expect(canBackfill(m!)).toBe(true);
  });

  it("reads a count of deals created, and a two-part snapshot", () => {
    const count = parseMapping(hs("weekly", { pipeline_id: "default", measure: "count", date: "created" }));
    expect(describeMapping(count!)).toBe("Count the deals in the pipeline created in the week.");
    const factored = parseMapping(
      hs("snapshot", {
        pipeline_id: "default",
        parts: [
          { stage_ids: ["closedwon"], value: "amount" },
          { stage_ids: ["quoted", "proposal"], value: "weighted_amount" },
        ],
        stage_labels: { closedwon: "Closed won", quoted: "Quoted", proposal: "Proposal" },
      })
    );
    expect(describeMapping(factored!)).toBe(
      'In the pipeline, add up the amount of the deals in "Closed won", plus the weighted amount (amount × probability) of the deals in "Quoted" or "Proposal", as they stand when the pull runs.'
    );
    expect(canBackfill(factored!)).toBe(false);
  });

  it("refuses a stage-dated recipe with no stage, a snapshot with no parts, and an unknown value", () => {
    expect(parseMapping(hs("weekly", { pipeline_id: "default", measure: "count", date: "entered_stage" }))).toBeNull();
    expect(parseMapping(hs("snapshot", { pipeline_id: "default", parts: [] }))).toBeNull();
    expect(parseMapping(hs("snapshot", { pipeline_id: "default", parts: [{ stage_ids: ["q"], value: "probability" }] }))).toBeNull();
    expect(parseMapping(hs("weekly", { pipeline_id: "has space", measure: "count", date: "created" }))).toBeNull();
  });

  it("names the missing HubSpot fields by the form's labels", () => {
    expect(missingMappingFields(hs("weekly", { measure: "count", date: "entered_stage" }))).toEqual(["Pipeline", "Stage"]);
    expect(missingMappingFields(hs("snapshot", { pipeline_id: "default", parts: [{ stage_ids: [] }] }))).toEqual(["Stages"]);
  });
});
