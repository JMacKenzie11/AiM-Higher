import { describe, it, expect, vi } from "vitest";
import {
  cascadeArchiveKpis,
  mirrorMeasureToKpi,
  mirrorOutcomeToCsf,
} from "./mirror";
import type { SupabaseClient } from "@supabase/supabase-js";

// The transition glue that keeps both models consistent through
// phases 3 to 7. Reads run off the new shape while writes still go to
// function_outcomes, so without these a newly created outcome would
// never appear as a CSF and the page would quietly stop showing new
// work.
//
// The field mapping is the part worth pinning. An outcome's `title`
// is the measure's `description`, because that is the field holding a
// measure's name, and the outcome's own `description` is the
// measure's `detail`. Swapping that pair puts a paragraph where a
// name belongs on every card, and nothing would fail loudly.

function fake() {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const links: Array<{ kpi_id: string }> = [];
  const client = {
    from: (table: string) => ({
      upsert: (payload: unknown) => {
        calls.push({ table, op: "upsert", payload });
        return Promise.resolve({ data: null, error: null });
      },
      update: (payload: unknown) => {
        calls.push({ table, op: "update", payload });
        const chain = {
          eq: () => Promise.resolve({ data: null, error: null }),
          in: (_c: string, ids: string[]) => {
            calls.push({ table, op: "update.in", payload: ids });
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      },
      select: () => ({
        eq: () => Promise.resolve({ data: links, error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, calls, links };
}

const OUTCOME = {
  id: "o_1",
  function_id: "f_1",
  title: "On-time delivery to promised date",
  description: "Why this matters to the customer.",
  sort_order: 2,
  archived: false,
};

describe("mirrorOutcomeToCsf", () => {
  it("maps title to description and description to detail", () => {
    const { client, calls } = fake();
    void mirrorOutcomeToCsf(client, OUTCOME);

    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.description).toBe("On-time delivery to promised date");
    expect(payload.detail).toBe("Why this matters to the customer.");
  });

  it("reuses the outcome id so links keep pointing at the right row", () => {
    const { client, calls } = fake();
    void mirrorOutcomeToCsf(client, OUTCOME);

    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.id).toBe("o_1");
  });

  it("writes kind csf with no parent outcome", () => {
    const { client, calls } = fake();
    void mirrorOutcomeToCsf(client, OUTCOME);

    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.kind).toBe("csf");
    expect(payload.outcome_id).toBeNull();
    expect(payload.function_id).toBe("f_1");
  });

  it("never opts a CSF into the weekly nudge", () => {
    // The performance cron opens a commitment for every auto_track
    // measure with no entry. A mirrored CSF must not generate one.
    const { client, calls } = fake();
    void mirrorOutcomeToCsf(client, OUTCOME);

    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.auto_track).toBe(false);
  });

  it("carries sort_order and archived through", () => {
    const { client, calls } = fake();
    void mirrorOutcomeToCsf(client, { ...OUTCOME, archived: true });

    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.sort_order).toBe(2);
    expect(payload.archived).toBe(true);
  });
});

describe("mirrorMeasureToKpi", () => {
  it("tags the measure and records the link", async () => {
    const { client, calls } = fake();
    await mirrorMeasureToKpi(client, {
      measureId: "m_1",
      outcomeId: "o_1",
      functionId: "f_1",
    });

    const update = calls.find(
      (c) => c.table === "success_measures" && c.op === "update"
    );
    expect(update?.payload).toEqual({ kind: "kpi", function_id: "f_1" });

    const link = calls.find((c) => c.table === "csf_kpi_links");
    expect(link?.payload).toEqual({ csf_id: "o_1", kpi_id: "m_1" });
  });

  it("uses the outcome id directly as the CSF id, with no lookup", async () => {
    // The migration reused the outcome id as the CSF measure id
    // precisely so this needs no extra query.
    const { client, calls } = fake();
    await mirrorMeasureToKpi(client, {
      measureId: "m_1",
      outcomeId: "o_1",
      functionId: "f_1",
    });

    expect(calls.some((c) => c.op === "select")).toBe(false);
  });
});

describe("cascadeArchiveKpis", () => {
  it("archives every KPI linked to the CSF and reports the count", async () => {
    const { client, calls, links } = fake();
    links.push({ kpi_id: "m_1" }, { kpi_id: "m_2" }, { kpi_id: "m_3" });

    const count = await cascadeArchiveKpis(client, "csf_1");

    expect(count).toBe(3);
    const update = calls.find((c) => c.op === "update.in");
    expect(update?.payload).toEqual(["m_1", "m_2", "m_3"]);
  });

  it("writes nothing when the CSF has no KPIs", async () => {
    const { client, calls } = fake();

    const count = await cascadeArchiveKpis(client, "csf_1");

    expect(count).toBe(0);
    expect(calls.some((c) => c.op === "update.in")).toBe(false);
  });
});
