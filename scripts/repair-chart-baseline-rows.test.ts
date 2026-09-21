import { describe, it, expect } from "vitest";
import {
  planFor,
  describePlan,
  parseArgs,
  summaryLines,
  deleteDuplicates,
  insertMissingBaselines,
  type RoleRow,
} from "./repair-chart-baseline-rows.ts";

// The decision, without a database. planFor takes every function_roles
// row for one instance and says what to do; everything dangerous about
// this script is in that function.

function role(over: Partial<RoleRow> & { id: string }): RoleRow {
  return {
    function_id: "fn1",
    title: "Something",
    is_default: false,
    ...over,
  };
}

const BASELINE = (id: string, function_id = "fn1") =>
  role({ id, function_id, title: "Lead, Track, Decide", is_default: true });

describe("planFor", () => {
  it("deletes the LMA duplicate and keeps the protected row", () => {
    const plan = planFor([
      BASELINE("keep"),
      role({
        id: "dupe",
        title:
          "Leadership, Management, and Accountability (LMA) for the sales and marketing function",
      }),
      role({ id: "real", title: "Business development and lead generation" }),
    ]);
    expect(plan.deleteIds).toEqual(["dupe"]);
    expect(plan.orphanIds).toEqual([]);
    expect(plan.missingBaselineFunctionIds).toEqual([]);
  });

  it("NEVER proposes an is_default row, whatever its title", () => {
    // The row this whole script exists to preserve. If a matcher
    // change ever made it look like a duplicate, this is the test
    // that stops the fleet losing every baseline it has.
    const plan = planFor([
      BASELINE("protected"),
      role({ id: "also", title: "LMA" }),
    ]);
    expect(plan.deleteIds).toEqual(["also"]);
    expect(plan.deleteIds).not.toContain("protected");
  });

  it("never proposes an is_default row even when its title is odd", () => {
    const plan = planFor([
      role({ id: "weird", title: "LMA", is_default: true }),
    ]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.missingBaselineFunctionIds).toEqual([]);
  });

  it("leaves a baseline-shaped row alone when it is the ONLY baseline", () => {
    // No is_default row on this function, so the duplicate is not a
    // duplicate — it is the function's whole baseline. Deleting it
    // would remove the thing the script protects.
    const plan = planFor([
      role({ id: "orphan", title: "LMA for operations" }),
      role({ id: "real", title: "Scheduling" }),
    ]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.orphanIds).toEqual(["orphan"]);
    expect(plan.missingBaselineFunctionIds).toEqual(["fn1"]);
  });

  it("scopes the sibling check per function, not across the table", () => {
    // fn1 has its baseline, fn2 does not. The LMA row on fn2 must not
    // be deleted just because SOME function somewhere has a baseline.
    const plan = planFor([
      BASELINE("b1", "fn1"),
      role({ id: "d1", function_id: "fn1", title: "LMA" }),
      role({ id: "o2", function_id: "fn2", title: "LMA" }),
    ]);
    expect(plan.deleteIds).toEqual(["d1"]);
    expect(plan.orphanIds).toEqual(["o2"]);
    expect(plan.missingBaselineFunctionIds).toEqual(["fn2"]);
  });

  it("does not touch real responsibilities that start with the same words", () => {
    const plan = planFor([
      BASELINE("b"),
      role({ id: "r1", title: "Lead generation" }),
      role({ id: "r2", title: "Leadership development programme" }),
      role({ id: "r3", title: "Tracking job costs" }),
    ]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("reports a clean instance as nothing to do", () => {
    const plan = planFor([
      BASELINE("b"),
      role({ id: "r", title: "Estimating and bid preparation" }),
    ]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.orphanIds).toEqual([]);
    expect(plan.missingBaselineFunctionIds).toEqual([]);
    expect(plan.totalRoles).toBe(2);
  });

  it("is idempotent — a repaired instance plans no further work", () => {
    const first = planFor([
      BASELINE("b"),
      role({ id: "dupe", title: "LMA" }),
    ]);
    const afterDelete = [BASELINE("b")];
    const second = planFor(afterDelete);
    expect(first.deleteIds).toEqual(["dupe"]);
    expect(second.deleteIds).toEqual([]);
    expect(second.missingBaselineFunctionIds).toEqual([]);
  });

  it("handles the real production shape", () => {
    // AiMS Construction Group: three functions, one LMA duplicate
    // each, plus CEO and COO which carry only their baseline.
    const rows: RoleRow[] = [];
    for (const fn of ["ceo", "coo"]) rows.push(BASELINE(`b_${fn}`, fn));
    for (const fn of ["sales", "ops", "finance"]) {
      rows.push(BASELINE(`b_${fn}`, fn));
      rows.push(
        role({
          id: `d_${fn}`,
          function_id: fn,
          title: `Leadership, Management, and Accountability (LMA) for ${fn}`,
        })
      );
      rows.push(role({ id: `r_${fn}`, function_id: fn, title: "Real work" }));
    }
    const plan = planFor(rows);
    expect(plan.deleteIds.sort()).toEqual(["d_finance", "d_ops", "d_sales"]);
    expect(plan.missingBaselineFunctionIds).toEqual([]);
    expect(plan.orphanIds).toEqual([]);
  });
});

describe("describePlan", () => {
  it("names only what applies", () => {
    expect(describePlan(planFor([BASELINE("b")]))).toBe(
      "0 duplicate(s) to delete (table holds 1)"
    );
  });

  it("calls out orphans and missing baselines", () => {
    const text = describePlan(
      planFor([role({ id: "o", title: "LMA", function_id: "fn9" })])
    );
    expect(text).toContain("1 function(s) missing a baseline");
    expect(text).toContain("1 orphan(s) left alone");
  });
});

describe("parseArgs", () => {
  it("defaults to writing, not dry-running", () => {
    // The default has to be the dangerous one made explicit, because a
    // script that silently dry-runs reports success and changes
    // nothing, which is worse than refusing.
    expect(parseArgs([])).toEqual({ dryRun: false, yes: false, instance: null });
  });

  it("reads the flags", () => {
    expect(parseArgs(["--dry-run", "--yes", "--instance", "promiseone"])).toEqual(
      { dryRun: true, yes: true, instance: "promiseone" }
    );
  });
});

describe("summaryLines", () => {
  it("says nothing was written on a dry run", () => {
    const out = summaryLines(
      [
        {
          subdomain: "@",
          state: "ok",
          planned: 9,
          deleted: 0,
          inserted: 0,
          detail: "would delete 9, insert 0",
        },
      ],
      true
    ).join("\n");
    expect(out).toContain("9 change(s) planned");
    expect(out).toContain("--dry-run: nothing was written.");
  });

  it("counts instances needing attention", () => {
    const out = summaryLines(
      [
        { subdomain: "@", state: "ok", planned: 9, deleted: 9, inserted: 0, detail: "" },
        { subdomain: "x", state: "blocked", planned: 0, deleted: 0, inserted: 0, detail: "" },
      ],
      false
    ).join("\n");
    expect(out).toContain("9 deleted, 0 inserted, 1 need attention");
  });
});

// ---- the write path, against a fake client ----------------------
//
// Not run against a live database: writes to one are Jason's, per
// CLAUDE.md. What can be proved here is the shape of the statements,
// and the guard on the delete is worth proving — it is the only thing
// standing between a bad id list and every baseline row on the fleet.

type Recorded = {
  table: string;
  op: string;
  filters: Array<[string, unknown]>;
  payload?: unknown;
};

function fakeDb(returnRows: Array<{ id: string }>) {
  const calls: Recorded[] = [];
  const client = {
    from(table: string) {
      const rec: Recorded = { table, op: "", filters: [] };
      const chain = {
        delete() {
          rec.op = "delete";
          return chain;
        },
        insert(payload: unknown) {
          rec.op = "insert";
          rec.payload = payload;
          return chain;
        },
        in(col: string, vals: unknown) {
          rec.filters.push([`in:${col}`, vals]);
          return chain;
        },
        eq(col: string, val: unknown) {
          rec.filters.push([`eq:${col}`, val]);
          return chain;
        },
        select() {
          calls.push(rec);
          return Promise.resolve({ data: returnRows, error: null });
        },
      };
      return chain;
    },
  };
  return { client, calls };
}

describe("deleteDuplicates", () => {
  it("guards the delete with is_default = false", () => {
    // Redundant with planFor, and kept anyway. If a future caller
    // ever hands this function an id list built somewhere else, this
    // clause is what keeps a protected row protected.
    const { client, calls } = fakeDb([{ id: "a" }]);
    return deleteDuplicates(client as never, ["a"]).then((n) => {
      expect(n).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.table).toBe("function_roles");
      expect(calls[0]!.op).toBe("delete");
      expect(calls[0]!.filters).toContainEqual(["eq:is_default", false]);
      expect(calls[0]!.filters).toContainEqual(["in:id", ["a"]]);
    });
  });

  it("chunks a long id list rather than sending one huge IN", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const { client, calls } = fakeDb([{ id: "x" }]);
    await deleteDuplicates(client as never, ids);
    expect(calls).toHaveLength(3); // 100 + 100 + 50
    for (const c of calls) {
      expect(c.filters).toContainEqual(["eq:is_default", false]);
    }
  });

  it("writes nothing for an empty list", async () => {
    const { client, calls } = fakeDb([]);
    expect(await deleteDuplicates(client as never, [])).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("insertMissingBaselines", () => {
  it("inserts the protected row at sort_order 0", async () => {
    const { client, calls } = fakeDb([{ id: "new" }]);
    const n = await insertMissingBaselines(client as never, ["fn7"]);
    expect(n).toBe(1);
    expect(calls[0]!.op).toBe("insert");
    expect(calls[0]!.payload).toEqual([
      {
        function_id: "fn7",
        title: "Lead, Track, Decide",
        body: null,
        sort_order: 0,
        is_default: true,
      },
    ]);
  });

  it("writes nothing when every function already has one", async () => {
    const { client, calls } = fakeDb([]);
    expect(await insertMissingBaselines(client as never, [])).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
