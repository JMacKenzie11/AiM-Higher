import { describe, it, expect, vi } from "vitest";

// writeMeasureEntries: the rules and the write, on a client it is
// handed. The grid's own tests, through the server action, live in
// actions.test.ts.

vi.mock("server-only", () => ({}));

import { writeMeasureEntries } from "./entries";

describe("writeMeasureEntries", () => {
  it("writes on the client it is handed, as the caller, and skips blanks", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T20:00:00Z"));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const tables: Record<string, unknown> = {
      success_measure_entries: { upsert },
      success_measures: {
        select: () => ({
          in: async () => ({
            data: [{ id: "m_1", company_id: "co_acme", update_frequency: "weekly", created_at: "2025-01-01T00:00:00Z" }],
          }),
        }),
      },
      companies: { select: () => ({ in: async () => ({ data: [{ id: "co_acme", timezone: "America/Anchorage" }] }) }) },
    };
    const db = { from: (table: string) => tables[table] };
    const writer = { db, profile: { id: "u_me", role: "team_member", company_id: "co_acme" } } as never;
    const r = await writeMeasureEntries(
      writer,
      [
        { measureId: "m_1", valueType: "number", rawValue: "12" },
        { measureId: "m_2", valueType: "number", rawValue: "  " },
      ],
      "2026-10-09"
    );
    expect(r).toEqual({ ok: true, savedCount: 1 });
    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ measure_id: "m_1", week_ending: "2026-10-09", value_number: 12, entered_by: "u_me" })],
      { onConflict: "measure_id,week_ending" }
    );
    vi.useRealTimers();
  });

  it("lands a monthly value on its month's own week, whichever week it was typed in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T20:00:00Z"));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const tables: Record<string, unknown> = {
      success_measure_entries: { upsert },
      success_measures: {
        select: () => ({
          in: async () => ({
            data: [{ id: "m_1", company_id: "co_acme", update_frequency: "monthly", created_at: "2025-01-01T00:00:00Z" }],
          }),
        }),
      },
      companies: { select: () => ({ in: async () => ({ data: [{ id: "co_acme", timezone: "America/Anchorage" }] }) }) },
    };
    const writer = { db: { from: (t: string) => tables[t] }, profile: { id: "u_me", role: "team_member", company_id: "co_acme" } } as never;
    const r = await writeMeasureEntries(writer, [{ measureId: "m_1", valueType: "number", rawValue: "3" }], "2026-10-09");
    expect(r).toEqual({ ok: true, savedCount: 1 });
    expect(upsert.mock.calls[0][0][0]).toMatchObject({ week_ending: "2026-10-30" });
    vi.useRealTimers();
  });
});
