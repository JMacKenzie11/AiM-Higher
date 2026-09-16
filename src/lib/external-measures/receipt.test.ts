import { describe, it, expect } from "vitest";

import { buildReceipt, formatPulledAt } from "./receipt";
import { latestByMeasureWeek, type PullLogRow } from "./service";

function row(over: Partial<PullLogRow> = {}): PullLogRow {
  return {
    id: "log-1",
    measure_id: "m1",
    week_ending: "2026-09-18",
    mapping_kind: "week_keyed",
    outcome: "written",
    value_written: 1310.5,
    failure_reason: null,
    detail: {
      kind: "week_keyed",
      file_id: "F",
      tab: "Dashboard Data",
      key_column: "Week Ending",
      value_column: "Pounds Shipped",
      matched_row: 4,
      raw_value: "$1,310.50",
    },
    created_at: "2026-09-20T14:04:00.000Z",
    ...over,
  };
}

describe("buildReceipt", () => {
  it("says what was read, from where, and what was recorded", () => {
    const r = buildReceipt(row());
    expect(r.outcome).toBe("written");
    expect(r.headline).toBe("Pulled from the spreadsheet");
    expect(r.problem).toBeNull();
    expect(r.mapping).toContain("Dashboard Data");
    const labels = r.lines.map((l) => l.label);
    expect(labels).toContain("Tab");
    expect(labels).toContain("Row on the sheet");
    expect(labels).toContain("Cell read");
    expect(labels).toContain("Recorded");
  });

  it("turns a failure code into a sentence a person can act on", () => {
    const r = buildReceipt(
      row({
        outcome: "failed",
        value_written: null,
        failure_reason: "week_row_absent",
        detail: {
          kind: "week_keyed",
          file_id: "F",
          tab: "Dashboard Data",
          key_column: "Week Ending",
          value_column: "Pounds Shipped",
          keys_seen: ["2026-09-04", "2026-09-11"],
        },
      })
    );
    expect(r.headline).toBe("Nothing was pulled");
    expect(r.problem).toContain("key column");
    const weeks = r.lines.find((l) => l.label === "Weeks found on the tab");
    expect(weeks?.value).toBe("2026-09-04, 2026-09-11");
  });

  it("describes a STALE snapshot as still having a freshness check", () => {
    // The bug this pins: detail stores freshness flat
    // (freshness_tab / freshness_cell), so rebuilding the mapping by
    // spreading detail produces a snapshot with no freshness — which
    // then describes itself as "No freshness date, so the value is
    // taken as current", on the very receipt that exists because the
    // freshness check declined.
    const r = buildReceipt(
      row({
        mapping_kind: "snapshot",
        outcome: "skipped_stale",
        value_written: null,
        detail: {
          kind: "snapshot",
          file_id: "F",
          tab: "Summary",
          cell: "B7",
          freshness_tab: "Meta",
          freshness_cell: "B2",
          freshness_date: "2026-08-30",
          value_seen: 42,
        },
      })
    );
    expect(r.mapping).toContain("Only record it when the date in B2");
    expect(r.mapping).not.toContain("No freshness date");
    const seen = r.lines.find(
      (l) => l.label === "Value seen but not recorded"
    );
    expect(seen?.value).toBe("42");
  });

  it("keeps Google's own words when the sheet could not be read", () => {
    const r = buildReceipt(
      row({
        outcome: "failed",
        value_written: null,
        failure_reason: "sheet_unreachable",
        detail: {
          kind: "week_keyed",
          file_id: "F",
          tab: "Dashboard Data",
          error: "Unable to parse range: 'Dashbord Data'",
        },
      })
    );
    const said = r.lines.find((l) => l.label === "What Google said");
    expect(said?.value).toBe("Unable to parse range: 'Dashbord Data'");
  });

  it("renders a row written by a version that stored something else", () => {
    // The log is append-only and outlives the code that wrote it. An
    // unknown outcome must still render, and must not render as a
    // success.
    const r = buildReceipt(
      row({ outcome: "something_new", value_written: null, detail: null })
    );
    expect(r.outcome).toBe("failed");
    expect(r.headline.length).toBeGreaterThan(0);
  });

  it("shows no line for a detail field that is absent", () => {
    const r = buildReceipt(row({ detail: { kind: "week_keyed", tab: "T" } }));
    expect(r.lines.map((l) => l.label)).not.toContain("Cell read");
  });
});

describe("formatPulledAt", () => {
  it("renders in the company's timezone, not the reader's", () => {
    // 14:04 UTC on a Sunday is 06:04 on Sunday in Anchorage. A
    // reader in London must see the same string as the client does,
    // because the week this belongs to was decided in the company's
    // timezone too.
    expect(formatPulledAt("2026-09-20T14:04:00.000Z", "America/Anchorage")).toBe(
      "Sun 6:04am"
    );
  });

  it("degrades to empty rather than to a time in the wrong zone", () => {
    expect(formatPulledAt("2026-09-20T14:04:00.000Z", "Mars/Olympus")).toBe("");
    expect(formatPulledAt("not a date", "America/Anchorage")).toBe("");
  });
});

describe("latestByMeasureWeek", () => {
  it("keeps the most recent receipt for a week that was pulled twice", () => {
    const rows: PullLogRow[] = [
      row({ id: "newer", created_at: "2026-09-20T15:00:00.000Z" }),
      row({ id: "older", created_at: "2026-09-20T14:00:00.000Z" }),
    ];
    const map = latestByMeasureWeek(rows);
    expect(map.get("m1:2026-09-18")?.id).toBe("newer");
  });

  it("keeps different measures and different weeks apart", () => {
    const rows: PullLogRow[] = [
      row({ id: "a", measure_id: "m1", week_ending: "2026-09-18" }),
      row({ id: "b", measure_id: "m2", week_ending: "2026-09-18" }),
      row({ id: "c", measure_id: "m1", week_ending: "2026-09-11" }),
    ];
    const map = latestByMeasureWeek(rows);
    expect(map.size).toBe(3);
  });
});
