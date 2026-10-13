import { describe, it, expect, vi } from "vitest";

// writeMeasureEntries: the rules and the write, on a client it is
// handed. The grid's own tests, through the server action, live in
// actions.test.ts.

vi.mock("server-only", () => ({}));

import { writeMeasureEntries } from "./entries";

describe("writeMeasureEntries", () => {
  it("writes on the client it is handed, as the caller, and skips blanks", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: (table: string) => (table === "success_measure_entries" ? { upsert } : null) };
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
  });
});
