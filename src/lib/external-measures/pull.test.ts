import { describe, it, expect } from "vitest";

import {
  decideSnapshot,
  decideWeekKeyed,
  freshnessCovers,
  runPull,
  failureSentence,
} from "./pull";
import type { SnapshotMapping, WeekKeyedMapping } from "./mapping";
import type { SheetReader } from "./sheets";

const WEEK = "2026-09-18";

const weekKeyed: WeekKeyedMapping = {
  kind: "week_keyed",
  file_id: "FILE",
  tab: "Dashboard Data",
  key_column: "Week Ending",
  value_column: "Pounds Shipped",
};

const snapshot: SnapshotMapping = {
  kind: "snapshot",
  file_id: "FILE",
  tab: "Summary",
  cell: "B7",
};

const TAB = [
  ["Week Ending", "Pounds Shipped", "Notes"],
  ["2026-09-04", "1,100", "short week"],
  ["2026-09-11", "1,250", ""],
  ["2026-09-18", "$1,310.50", ""],
];

describe("decideWeekKeyed", () => {
  it("finds the week's row and reads the value column", () => {
    const d = decideWeekKeyed(TAB, weekKeyed, WEEK);
    expect(d.outcome).toBe("written");
    if (d.outcome !== "written") return;
    expect(d.value).toBe(1310.5);
    // The row number a person would look at, so the receipt can be
    // checked by eye against the sheet.
    expect(d.detail.matched_row).toBe(4);
    expect(d.detail.raw_value).toBe("$1,310.50");
  });

  it("matches headings case-insensitively and ignores stray spaces", () => {
    const messy = [
      ["week ending ", " Pounds Shipped"],
      ["2026-09-18", "7"],
    ];
    const d = decideWeekKeyed(messy, weekKeyed, WEEK);
    expect(d.outcome).toBe("written");
  });

  it("matches a week however the sheet spells the date", () => {
    const slashed = [
      ["Week Ending", "Pounds Shipped"],
      ["9/18/2026", "7"],
    ];
    expect(decideWeekKeyed(slashed, weekKeyed, WEEK).outcome).toBe("written");
  });

  it("writes NOTHING when the week has no row", () => {
    const d = decideWeekKeyed(TAB.slice(0, 3), weekKeyed, WEEK);
    expect(d.outcome).toBe("failed");
    if (d.outcome !== "failed") return;
    expect(d.reason).toBe("week_row_absent");
    // The control on the empty set: the receipt says which weeks
    // WERE there, so "this week is not filled in yet" cannot be
    // confused with "the key column holds something other than
    // dates".
    expect(d.detail.keys_seen).toEqual(["2026-09-04", "2026-09-11"]);
  });

  it("writes NOTHING when the value cell is not a number", () => {
    const d = decideWeekKeyed(
      [
        ["Week Ending", "Pounds Shipped"],
        ["2026-09-18", "pending"],
      ],
      weekKeyed,
      WEEK
    );
    expect(d.outcome).toBe("failed");
    if (d.outcome !== "failed") return;
    expect(d.reason).toBe("value_unparseable");
    expect(d.detail.raw_value).toBe("pending");
  });

  it("writes NOTHING when the value cell for the week is blank", () => {
    // The case that matters most: the week's row exists because the
    // client added it on Monday, and the number lands on Friday. A
    // blank must not become a zero.
    const d = decideWeekKeyed(
      [
        ["Week Ending", "Pounds Shipped"],
        ["2026-09-18", ""],
      ],
      weekKeyed,
      WEEK
    );
    expect(d.outcome).toBe("failed");
  });

  it("names the headings it did find when a column is missing", () => {
    const d = decideWeekKeyed(
      [
        ["Week", "Pounds"],
        ["2026-09-18", "7"],
      ],
      weekKeyed,
      WEEK
    );
    expect(d.outcome).toBe("failed");
    if (d.outcome !== "failed") return;
    expect(d.reason).toBe("key_column_missing");
    expect(d.detail.headings_found).toEqual(["Week", "Pounds"]);
  });

  it("survives a ragged tab, which Sheets returns for trailing blanks", () => {
    const ragged = [["Week Ending", "Pounds Shipped"], ["2026-09-18"]];
    const d = decideWeekKeyed(ragged, weekKeyed, WEEK);
    expect(d.outcome).toBe("failed");
  });

  it("is empty-safe", () => {
    expect(decideWeekKeyed([], weekKeyed, WEEK).outcome).toBe("failed");
  });
});

describe("freshnessCovers", () => {
  it("accepts the week's own Friday and the days just after it", () => {
    expect(freshnessCovers("2026-09-18", WEEK)).toBe(true);
    expect(freshnessCovers("2026-09-21", WEEK)).toBe(true);
    expect(freshnessCovers("2026-09-24", WEEK)).toBe(true);
  });

  it("refuses a date inside the week but before it ends", () => {
    // A sheet last touched on Monday is not evidence for a week that
    // runs to Friday.
    expect(freshnessCovers("2026-09-14", WEEK)).toBe(false);
    expect(freshnessCovers("2026-08-01", WEEK)).toBe(false);
  });

  it("REFUSES a date far newer than the week, which a floor rule would accept", () => {
    // The bug this pins. A snapshot holds one value describing one
    // period, so under "is the sheet at least as new as the week"
    // every OLDER week passes too — and a walk over four weeks would
    // write today's number into all four, identically. A flat line
    // that looks like data.
    expect(freshnessCovers("2026-09-25", WEEK)).toBe(false);
    expect(freshnessCovers("2026-11-01", WEEK)).toBe(false);
  });

  it("puts the real client caption's date on the right week, and no other", () => {
    // "Latest completed week: Sep 6, 2026 to Sep 12, 2026" reads as
    // 2026-09-12, a Saturday. Platform weeks end Friday, so it
    // belongs to the week ending Sep 11 and to nothing else.
    expect(freshnessCovers("2026-09-12", "2026-09-11")).toBe(true);
    expect(freshnessCovers("2026-09-12", "2026-09-18")).toBe(false);
    expect(freshnessCovers("2026-09-12", "2026-09-04")).toBe(false);
  });
});

describe("decideSnapshot", () => {
  it("reads the cell when there is no freshness field", () => {
    const d = decideSnapshot("42", undefined, snapshot, WEEK);
    expect(d.outcome).toBe("written");
    if (d.outcome !== "written") return;
    expect(d.value).toBe(42);
  });

  it("records the value when the freshness date covers the week", () => {
    const mapping: SnapshotMapping = {
      ...snapshot,
      freshness: { tab: "Summary", cell: "B2" },
    };
    const d = decideSnapshot("42", "2026-09-18", mapping, WEEK);
    expect(d.outcome).toBe("written");
    if (d.outcome !== "written") return;
    expect(d.detail.freshness_date).toBe("2026-09-18");
  });

  it("DECLINES when the freshness date is older than the week", () => {
    const mapping: SnapshotMapping = {
      ...snapshot,
      freshness: { tab: "Summary", cell: "B2" },
    };
    const d = decideSnapshot("42", "2026-08-30", mapping, WEEK);
    expect(d.outcome).toBe("skipped_stale");
    expect(d.detail.freshness_date).toBe("2026-08-30");
    // The number is reported without being recorded: "stale and
    // unchanged" is a different conversation from "stale and moved".
    expect(d.detail.value_seen).toBe(42);
  });

  it("reads a freshness cell written as a sentence", () => {
    // The whole reason parseFreshnessDate exists: the real cell is a
    // caption, not a date cell, and refusing it would mean declining
    // every pull forever.
    const mapping: SnapshotMapping = {
      ...snapshot,
      freshness: { tab: "Dashboard", cell: "B2" },
    };
    const d = decideSnapshot(
      "58.26",
      "Latest completed week: Sep 6, 2026 to Sep 12, 2026",
      mapping,
      "2026-09-11"
    );
    expect(d.outcome).toBe("written");
    if (d.outcome !== "written") return;
    expect(d.value).toBe(58.26);
    expect(d.detail.freshness_date).toBe("2026-09-12");
  });

  it("declines when the freshness cell is not a date at all", () => {
    const mapping: SnapshotMapping = {
      ...snapshot,
      freshness: { tab: "Summary", cell: "B2" },
    };
    const d = decideSnapshot("42", "last week", mapping, WEEK);
    expect(d.outcome).toBe("failed");
    if (d.outcome !== "failed") return;
    expect(d.reason).toBe("freshness_unreadable");
  });

  it("declines when the freshness cell is empty", () => {
    const mapping: SnapshotMapping = {
      ...snapshot,
      freshness: { tab: "Summary", cell: "B2" },
    };
    expect(decideSnapshot("42", null, mapping, WEEK).outcome).toBe("failed");
  });

  it("writes NOTHING when the cell is empty", () => {
    expect(decideSnapshot(null, undefined, snapshot, WEEK).outcome).toBe(
      "failed"
    );
  });
});

describe("runPull", () => {
  function reader(overrides: Partial<SheetReader>): SheetReader {
    return {
      readTab: async () => [],
      readCell: async () => null,
      ...overrides,
    };
  }

  it("addresses the mapped tab, not whatever tab is first", () => {
    // The trap this feature was built around: drive.files.export
    // returns only the first tab, silently. The reader has to be
    // ASKED for a tab, so this asserts the tab reaches it.
    const seen: string[] = [];
    const r = reader({
      readTab: async (_file, tab) => {
        seen.push(tab);
        return TAB;
      },
    });
    return runPull(r, weekKeyed, WEEK).then((d) => {
      expect(seen).toEqual(["Dashboard Data"]);
      expect(d.outcome).toBe("written");
    });
  });

  it("turns anything the sheet client throws into a no-write", async () => {
    const r = reader({
      readTab: async () => {
        throw new Error("The caller does not have permission");
      },
    });
    const d = await runPull(r, weekKeyed, WEEK);
    expect(d.outcome).toBe("failed");
    if (d.outcome !== "failed") return;
    expect(d.reason).toBe("sheet_unreachable");
    // Google's own words survive. They are the only specific thing
    // on the receipt when this happens.
    expect(d.detail.error).toBe("The caller does not have permission");
  });

  it("reads the freshness cell from its own tab", async () => {
    const asked: Array<[string, string]> = [];
    const r = reader({
      readCell: async (_file, tab, cell) => {
        asked.push([tab, cell]);
        return tab === "Meta" ? "2026-09-19" : "42";
      },
    });
    const mapping: SnapshotMapping = {
      ...snapshot,
      freshness: { tab: "Meta", cell: "B2" },
    };
    const d = await runPull(r, mapping, WEEK);
    expect(asked).toEqual([
      ["Summary", "B7"],
      ["Meta", "B2"],
    ]);
    expect(d.outcome).toBe("written");
  });
});

describe("failureSentence", () => {
  it("has a sentence for every code it is given", () => {
    expect(failureSentence("week_row_absent")).toContain("key column");
  });

  it("does not return an empty string for a code it has never seen", () => {
    // The log is append-only and will outlive this code. A reason
    // written by an older version must still render as something.
    expect(failureSentence("something_new").length).toBeGreaterThan(0);
  });
});
