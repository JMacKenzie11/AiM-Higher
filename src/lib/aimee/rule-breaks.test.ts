import { describe, it, expect, vi } from "vitest";
import { bannedRulesIn, recordRuleBreak } from "./rule-breaks";

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

describe("bannedRulesIn", () => {
  it("names each rule once, from Aimee's own words", () => {
    expect(bannedRulesIn("Read the room. The room agreed, instead of arguing it out.")).toEqual(
      expect.arrayContaining(["the room", "X instead of Y"])
    );
    expect(bannedRulesIn("Read the room. The room agreed.")).toEqual(["the room"]);
  });

  it("leaves a quote of what somebody said alone", () => {
    expect(bannedRulesIn('Carmen said "one document instead of all these files". Who owns it?')).toEqual([]);
  });
});

describe("recordRuleBreak", () => {
  it("records the rules and the surface, never the reply, and says so in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeDb();
    await recordRuleBreak(db as never, { ...base, surface: "conversation", origin: "panel", rules: ["the room", "the room"] });
    expect(db.rows).toEqual([
      { company_id: "co", profile_id: "me", surface: "conversation", origin: "panel", rules: ["the room"] },
    ]);
    expect(String(warn.mock.calls[0][0])).toMatch(/conversation shown with a voice rule still broken \(c1\): the room/);
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

// Jason, 2026-09-29: a reply opening "I'm Aimee" is a rule break. The
// panel and the page already say who she is.
describe("introducing herself", () => {
  it("counts a reply that opens with her name", () => {
    for (const reply of [
      "I'm Aimee. I can help you work through this.",
      "I’m Aimee, the AiMS Leadership Coach. Happy to help.",
      "Hi, I'm Aimee. What's been happening?",
      "I am Aimee, and I can help with that.",
    ]) {
      expect(bannedRulesIn(reply), reply).toContain("introduced herself");
    }
  });

  it("leaves her name alone anywhere else", () => {
    expect(bannedRulesIn("Let's work through it together. What's been happening with them?")).toEqual([]);
    expect(bannedRulesIn("You can ask Aimee on the page too.")).toEqual([]);
  });
});

// Jason, 2026-09-29: the debrief's contrast phrases, counted in every
// reply, never retried. Aimee's own words only.
describe("contrast phrases", () => {
  it("counts rather than, instead of and not just", () => {
    expect(bannedRulesIn("That's frustrating when it keeps happening rather than being a one-off.")).toContain("rather than");
    expect(bannedRulesIn("Ask them instead of guessing.")).toContain("X instead of Y");
    expect(bannedRulesIn("It's the timing, not just the workload.")).toContain("not just");
  });

  it("leaves them alone inside a quote of what somebody said", () => {
    expect(bannedRulesIn('You said "rather than argue, we just move on". What made that the habit?')).toEqual([]);
    expect(bannedRulesIn('Carmen said "not just me, the whole team". Who else noticed?')).toEqual([]);
  });
});

// Jason, 2026-09-30: two slips from the test replies, where a pattern
// can say so without guessing.
describe("stock openings and harsh words", () => {
  it("counts a stock phrase in the first sentence only", () => {
    expect(bannedRulesIn("Bringing in the most revenue is real, and worth protecting. What happens when she works with ops?")).toContain("stock opening: is real");
    expect(bannedRulesIn("Let's look at it. What makes the progress feel real to you?")).toEqual([]);
  });

  it("counts their harsh word said back, quoted or not, and only theirs", () => {
    const theirs = "My top salesperson brings in the most revenue but she's awful to the ops team";
    expect(bannedRulesIn('Bringing in the most revenue takes skill. What does "awful to the ops team" look like when it happens?', theirs)).toContain("repeated their harsh word");
    expect(bannedRulesIn("Bringing in the most revenue takes skill. What happens when she works with ops?", theirs)).toEqual([]);
    expect(bannedRulesIn("That sounds terrible to sit through. What happened?", "The meeting ran long")).toEqual([]);
    expect(bannedRulesIn('What does "awful" look like?')).toEqual([]);
  });
});
