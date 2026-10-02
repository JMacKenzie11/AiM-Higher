import { describe, it, expect, vi } from "vitest";
import { recordRuleBreak } from "./rule-breaks";

function fakeDb(error: { code: string; message: string } | null = null) {
  const rows: unknown[] = [];
  return {
    rows,
    from: () => ({
      insert: async (row: unknown) => {
        rows.push(row);
        return { error };
      },
    }),
  };
}

const base = {
  companyId: "co",
  profileId: "me",
  role: "team_member" as const,
  conversationId: "c1",
};

describe("recordRuleBreak", () => {
  it("records the rules and the surface, never the reply, and says so in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeDb();
    await recordRuleBreak(db as never, { ...base, surface: "conversation", origin: "panel", rules: ["the room", "the room"] });
    expect(db.rows).toEqual([
      { company_id: "co", profile_id: "me", surface: "conversation", origin: "panel", practice_id: null, rules: ["the room"] },
    ]);
    expect(String(warn.mock.calls[0][0])).toMatch(/conversation shown with a voice rule still broken \(c1\): the room/);
    warn.mockRestore();
  });

  it("records the agent the conversation runs (0254)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeDb();
    await recordRuleBreak(db as never, { ...base, surface: "first_reply", practiceId: "role-description", rules: ["a choice question"] });
    expect(db.rows[0]).toMatchObject({ surface: "first_reply", origin: null, practice_id: "role-description" });
    warn.mockRestore();
  });

  it("gives a checked turn no origin", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeDb();
    await recordRuleBreak(db as never, { ...base, surface: "debrief_reply", origin: "panel", rules: ["invented quote"] });
    expect(db.rows[0]).toMatchObject({ surface: "debrief_reply", origin: null });
    warn.mockRestore();
  });

  it("records nothing when nothing is broken", async () => {
    const db = fakeDb();
    await recordRuleBreak(db as never, { ...base, surface: "conversation", rules: [] });
    expect(db.rows).toEqual([]);
  });

  it("never writes for a portfolio admin, only logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeDb();
    await recordRuleBreak(db as never, { ...base, role: "portfolio_admin", surface: "conversation", rules: ["the room"] });
    expect(db.rows).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("says so when the database refuses the row", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ code: "42501", message: "new row violates row-level security policy" });
    await recordRuleBreak(db as never, { ...base, surface: "conversation", rules: ["the room"] });
    expect(String(err.mock.calls[0][0])).toMatch(/rule break not recorded/);
    warn.mockRestore();
    err.mockRestore();
  });
});
