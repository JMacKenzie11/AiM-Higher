import { describe, it, expect, vi } from "vitest";

import { syncFleet, summaryLines, type Target } from "../../sync-content.ts";
import type { SyncDataset } from "./datasets.ts";
import type { Row } from "./diff.ts";

// Isolation and dry-run, tested against fake clients.
//
// These are the two properties hardest to see by reading and worst to
// get wrong: a loop that stops on the first failure leaves the rest of
// the fleet in an unknown state, and a dry run that writes is a dry
// run that has already happened.

const DATASET: SyncDataset = {
  name: "test",
  description: "one table",
  tables: [{ table: "widgets", primaryKey: ["id"] }],
};

// Minimal stand-in for the bits of the Supabase client this tool uses.
function fakeClient(rows: Row[], opts: { failOn?: string } = {}) {
  const writes: Array<{ op: string; rows: unknown }> = [];
  const client = {
    writes,
    from(table: string) {
      if (opts.failOn === table) {
        throw new Error(`boom on ${table}`);
      }
      return {
        select: () => ({
          range: async () => ({ data: rows, error: null }),
          limit: async () => ({ data: rows.slice(0, 1), error: null }),
        }),
        upsert: async (r: unknown) => {
          writes.push({ op: "upsert", rows: r });
          return { error: null };
        },
        delete: () => {
          const q = {
            eq: () => q,
            then: (resolve: (v: { error: null }) => void) => {
              writes.push({ op: "delete", rows: null });
              resolve({ error: null });
            },
          };
          return q;
        },
      };
    },
  };
  return client as unknown as Target["client"] & { writes: typeof writes };
}

function target(subdomain: string, client: ReturnType<typeof fakeClient>): Target {
  return { subdomain, envPrefix: subdomain.toUpperCase(), client, aliases: [] };
}

describe("syncFleet: per-instance isolation", () => {
  it("keeps going when the first instance throws", async () => {
    const source = fakeClient([{ id: "a", name: "one" }]);
    const broken = fakeClient([], { failOn: "widgets" });
    const healthy = fakeClient([]);
    const log = vi.fn();

    const outcomes = await syncFleet({
      targets: [target("alpha", broken), target("beta", healthy)],
      primary: source,
      datasets: [DATASET],
      dryRun: false,
      log,
    });

    expect(outcomes.map((o) => o.subdomain)).toEqual(["alpha", "beta"]);
    expect(outcomes[0].ok).toBe(false);
    expect(outcomes[0].error).toContain("boom");
    // The second instance ran anyway, and actually wrote.
    expect(outcomes[1].ok).toBe(true);
    expect(healthy.writes.some((w) => w.op === "upsert")).toBe(true);
  });

  it("reports the failure by instance name", async () => {
    const outcomes = await syncFleet({
      targets: [target("alpha", fakeClient([], { failOn: "widgets" }))],
      primary: fakeClient([]),
      datasets: [DATASET],
      dryRun: false,
      log: vi.fn(),
    });
    expect(summaryLines(outcomes)[0]).toContain("alpha");
    expect(summaryLines(outcomes)[0]).toContain("FAILED");
  });
});

describe("syncFleet: --dry-run", () => {
  it("plans the same work but writes nothing", async () => {
    const source = fakeClient([{ id: "a", name: "one" }]);
    const t = fakeClient([]);
    const log = vi.fn();

    const outcomes = await syncFleet({
      targets: [target("alpha", t)],
      primary: source,
      datasets: [DATASET],
      dryRun: true,
      log,
    });

    // The plan is computed and reported...
    expect(outcomes[0].diffs[0].inserts).toHaveLength(1);
    expect(log.mock.calls.flat().join("\n")).toContain("widgets");
    // ...and nothing was written.
    expect(t.writes).toEqual([]);
  });

  it("writes when the flag is absent", async () => {
    const t = fakeClient([]);
    await syncFleet({
      targets: [target("alpha", t)],
      primary: fakeClient([{ id: "a", name: "one" }]),
      datasets: [DATASET],
      dryRun: false,
      log: vi.fn(),
    });
    expect(t.writes.filter((w) => w.op === "upsert")).toHaveLength(1);
  });
});

describe("summaryLines", () => {
  it("says in sync when nothing changed", async () => {
    const rows = [{ id: "a", name: "one" }];
    const outcomes = await syncFleet({
      targets: [target("alpha", fakeClient(rows))],
      primary: fakeClient(rows),
      datasets: [DATASET],
      dryRun: true,
      log: vi.fn(),
    });
    expect(summaryLines(outcomes)[0]).toContain("in sync");
  });

  it("counts each operation separately", async () => {
    const outcomes = await syncFleet({
      targets: [target("alpha", fakeClient([{ id: "old", name: "gone" }]))],
      primary: fakeClient([{ id: "new", name: "here" }]),
      datasets: [DATASET],
      dryRun: true,
      log: vi.fn(),
    });
    expect(summaryLines(outcomes)[0]).toContain("1 inserted, 0 updated, 1 deleted");
  });
});
