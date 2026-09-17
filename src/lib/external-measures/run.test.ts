import { describe, it, expect, vi } from "vitest";

import { pullMeasureWeek, messageFor, type PullPath } from "./run";
import type { SheetReader } from "./sheets";
import type { ExternalMapping } from "./mapping";

const WEEK = "2026-09-18";

const mapping: ExternalMapping = {
  kind: "week_keyed",
  file_id: "F",
  tab: "Dashboard Data",
  key_column: "Week Ending",
  value_column: "Pounds Shipped",
};

const TAB = [
  ["Week Ending", "Pounds Shipped"],
  ["2026-09-18", "1,310.50"],
];

// A Supabase client is only ever asked for one thing here, so it is
// stubbed to that one thing rather than mocked wholesale. The stub
// records which RPC was called and with what, which is the entire
// claim this file makes about the seam.
function stubDb(outcome: string, error?: { message: string }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (error) return { data: null, error };
      return { data: [{ outcome, log_id: "log-1" }], error: null };
    }),
  };
  return { db: db as never, calls };
}

function reader(overrides: Partial<SheetReader> = {}): SheetReader {
  return {
    readTab: async () => TAB,
    readCell: async () => null,
    ...overrides,
  };
}

describe("the seam: one core, two clients", () => {
  it.each<[PullPath, string]>([
    ["caller", "record_external_pull"],
    ["scheduled", "record_external_pull_scheduled"],
  ])("path %s writes through %s", async (path, fn) => {
    const { db, calls } = stubDb("written");
    const result = await pullMeasureWeek(db, {
      path,
      measureId: "m1",
      companyId: "c1",
      weekEnding: WEEK,
      mapping,
      reader: reader(),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe(fn);
    expect(result.outcome).toBe("written");
    expect(result.value).toBe(1310.5);
  });

  it("sends IDENTICAL arguments on both paths", async () => {
    // The difference between the two paths is which function name is
    // called and nothing else. Anything that differed here would be a
    // rule living in the wrapper, which is exactly what the database
    // migration exists to prevent.
    const a = stubDb("written");
    const b = stubDb("written");
    const args = {
      measureId: "m1",
      companyId: "c1",
      weekEnding: WEEK,
      mapping,
      reader: reader(),
    };
    await pullMeasureWeek(a.db, { path: "caller", ...args });
    await pullMeasureWeek(b.db, { path: "scheduled", ...args });
    expect(a.calls[0].args).toEqual(b.calls[0].args);
  });

  it("reports what the DATABASE did, not what it asked for", async () => {
    // The core asked to write. The database came back with
    // skipped_manual_exists because a person had already typed the
    // week. Saying "written" here would be the app telling a user
    // something the database had just refused.
    const { db } = stubDb("skipped_manual_exists");
    const result = await pullMeasureWeek(db, {
      path: "scheduled",
      measureId: "m1",
      companyId: "c1",
      weekEnding: WEEK,
      mapping,
      reader: reader(),
    });
    expect(result.outcome).toBe("skipped_manual_exists");
    expect(result.value).toBeNull();
    expect(result.message).toMatch(/typed value always wins/i);
  });

  it("reports the scheduler's idempotent skip as its own outcome", async () => {
    const { db } = stubDb("skipped_exists");
    const result = await pullMeasureWeek(db, {
      path: "scheduled",
      measureId: "m1",
      companyId: "c1",
      weekEnding: WEEK,
      mapping,
      reader: reader(),
    });
    expect(result.outcome).toBe("skipped_exists");
    expect(result.value).toBeNull();
    expect(result.message).toMatch(/already been pulled/i);
  });

  it("logs a mapping that will not parse instead of skipping it", async () => {
    const { db, calls } = stubDb("failed");
    const result = await pullMeasureWeek(db, {
      path: "scheduled",
      measureId: "m1",
      companyId: "c1",
      weekEnding: WEEK,
      mapping: null,
      rawSource: { kind: "snapshot", tab: "T" },
      reader: reader(),
    });
    expect(calls[0].args.p_outcome).toBe("failed");
    expect(calls[0].args.p_failure_reason).toBe("mapping_invalid");
    expect(result.outcome).toBe("failed");
  });

  it("throws when the RECEIPT cannot be written", async () => {
    // A failed pull is a normal outcome with a row behind it. No row
    // at all is the absence of one, and the cron counts it as a
    // failure rather than reporting a silent success.
    const { db } = stubDb("written", { message: "connection refused" });
    await expect(
      pullMeasureWeek(db, {
        path: "scheduled",
        measureId: "m1",
        companyId: "c1",
        weekEnding: WEEK,
        mapping,
        reader: reader(),
      })
    ).rejects.toThrow(/connection refused/);
  });
});

describe("retry", () => {
  it("retries ONCE on a transient failure, then leaves the week awaiting", async () => {
    const { db, calls } = stubDb("failed");
    let reads = 0;
    const result = await pullMeasureWeek(db, {
      path: "scheduled",
      measureId: "m1",
      companyId: "c1",
      weekEnding: WEEK,
      mapping,
      reader: reader({
        readTab: async () => {
          reads += 1;
          throw new Error("socket hang up");
        },
      }),
    });
    expect(reads).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.outcome).toBe("failed");
    // ONE receipt, not two. The retry is an implementation detail of
    // one attempt at one week, not two attempts to be accounted for.
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_failure_reason).toBe("sheet_unreachable");
  });

  it("does NOT retry a failure that will answer identically", async () => {
    const { db } = stubDb("failed");
    let reads = 0;
    const result = await pullMeasureWeek(db, {
      path: "scheduled",
      measureId: "m1",
      companyId: "c1",
      weekEnding: WEEK,
      mapping,
      reader: reader({
        readTab: async () => {
          reads += 1;
          throw new Error("Unable to parse range: 'Dashbord Data'");
        },
      }),
    });
    expect(reads).toBe(1);
    expect(result.attempts).toBe(1);
  });

  it("does not retry a week that was simply absent", async () => {
    // Not a transport failure. The sheet answered; the week was not
    // in it. Reading it again changes nothing and the week correctly
    // stays awaiting.
    const { db } = stubDb("failed");
    let reads = 0;
    const result = await pullMeasureWeek(db, {
      path: "scheduled",
      measureId: "m1",
      companyId: "c1",
      weekEnding: WEEK,
      mapping,
      reader: reader({
        readTab: async () => {
          reads += 1;
          return [["Week Ending", "Pounds Shipped"], ["2026-09-11", "1"]];
        },
      }),
    });
    expect(reads).toBe(1);
    expect(result.outcome).toBe("failed");
  });

  it("succeeds on the second attempt when the first was a blip", async () => {
    const { db } = stubDb("written");
    let reads = 0;
    const result = await pullMeasureWeek(db, {
      path: "scheduled",
      measureId: "m1",
      companyId: "c1",
      weekEnding: WEEK,
      mapping,
      reader: reader({
        readTab: async () => {
          reads += 1;
          if (reads === 1) throw new Error("ETIMEDOUT");
          return TAB;
        },
      }),
    });
    expect(result.outcome).toBe("written");
    expect(result.value).toBe(1310.5);
    expect(result.attempts).toBe(2);
  });
});

describe("messageFor", () => {
  it("has a sentence for every outcome", () => {
    const decision = { outcome: "written", value: 7, detail: {} } as const;
    for (const outcome of [
      "written",
      "skipped_manual_exists",
      "skipped_exists",
      "skipped_stale",
      "failed",
    ] as const) {
      expect(messageFor(outcome, decision).length).toBeGreaterThan(0);
    }
  });
});
