import { describe, it, expect } from "vitest";

import {
  describeMapping,
  extractFileId,
  isCellRef,
  parseMapping,
} from "./mapping";

describe("parseMapping", () => {
  it("reads a week_keyed mapping", () => {
    expect(
      parseMapping({
        kind: "week_keyed",
        file_id: "F",
        tab: "Data",
        key_column: "Week Ending",
        value_column: "Shipped",
      })
    ).toEqual({
      kind: "week_keyed",
      file_id: "F",
      tab: "Data",
      key_column: "Week Ending",
      value_column: "Shipped",
    });
  });

  it("reads a snapshot mapping, with and without freshness", () => {
    expect(
      parseMapping({ kind: "snapshot", file_id: "F", tab: "S", cell: "B7" })
    ).toEqual({ kind: "snapshot", file_id: "F", tab: "S", cell: "B7" });

    expect(
      parseMapping({
        kind: "snapshot",
        file_id: "F",
        tab: "S",
        cell: "B7",
        freshness: { tab: "S", cell: "B2" },
      })
    ).toEqual({
      kind: "snapshot",
      file_id: "F",
      tab: "S",
      cell: "B7",
      freshness: { tab: "S", cell: "B2" },
    });
  });

  it("trims, because a pasted tab name carries a trailing space", () => {
    const m = parseMapping({
      kind: "snapshot",
      file_id: " F ",
      tab: " Summary ",
      cell: " B7 ",
    });
    expect(m).toEqual({
      kind: "snapshot",
      file_id: "F",
      tab: "Summary",
      cell: "B7",
    });
  });

  it("refuses HALF a freshness field", () => {
    // Worse than none: it reads as a check that is running when it
    // is not, and the client believes stale numbers are being
    // declined when they are being written.
    expect(
      parseMapping({
        kind: "snapshot",
        file_id: "F",
        tab: "S",
        cell: "B7",
        freshness: { tab: "S" },
      })
    ).toBeNull();
  });

  it("refuses a mapping missing any required field", () => {
    expect(parseMapping({ kind: "week_keyed", file_id: "F", tab: "D" })).toBeNull();
    expect(
      parseMapping({ kind: "week_keyed", file_id: "F", tab: "D", key_column: "W" })
    ).toBeNull();
    expect(parseMapping({ kind: "snapshot", file_id: "F", tab: "S" })).toBeNull();
    expect(parseMapping({ kind: "week_keyed", tab: "D" })).toBeNull();
  });

  it("refuses an empty string, which is not the same as a value", () => {
    expect(
      parseMapping({ kind: "snapshot", file_id: "F", tab: "  ", cell: "B7" })
    ).toBeNull();
  });

  it("refuses an unknown kind, which is how phase 3 stays deliberate", () => {
    expect(
      parseMapping({ kind: "hubspot", file_id: "F", tab: "D", cell: "B1" })
    ).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    expect(parseMapping(null)).toBeNull();
    expect(parseMapping(undefined)).toBeNull();
    expect(parseMapping("week_keyed")).toBeNull();
    expect(parseMapping([])).toBeNull();
    expect(parseMapping(7)).toBeNull();
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
  it("says what a week_keyed mapping does in words", () => {
    const words = describeMapping({
      kind: "week_keyed",
      file_id: "F",
      tab: "Dashboard Data",
      key_column: "Week Ending",
      value_column: "Shipped",
    });
    expect(words).toContain("Dashboard Data");
    expect(words).toContain("Week Ending");
    expect(words).toContain("Shipped");
  });

  it("describes a plain snapshot without mentioning freshness at all", () => {
    // The form has no freshness field, so naming its absence only
    // raises a question about a control the reader cannot find.
    const words = describeMapping({
      kind: "snapshot",
      file_id: "F",
      tab: "S",
      cell: "b7",
    });
    expect(words).toContain("B7");
    expect(words).not.toMatch(/freshness/i);
  });

  it("names the freshness cell when there is one", () => {
    const words = describeMapping({
      kind: "snapshot",
      file_id: "F",
      tab: "S",
      cell: "B7",
      freshness: { tab: "Meta", cell: "b2" },
    });
    expect(words).toContain("B2");
    expect(words).toContain("Meta");
  });
});
