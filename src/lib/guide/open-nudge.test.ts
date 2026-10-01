import { beforeEach, describe, expect, it, vi } from "vitest";

// OPENING A GUIDE INVITATION, from the panel or the nudge page: one
// function, so the two cannot drift (open-nudge.ts). What has to hold:
//
//   - only the recipient opens it, and a refusal writes nothing
//   - opening records the nudge as opened, with its conversation, and
//     marks the notification read
//   - a second open lands on the same conversation, creating nothing
//   - a declined invitation stays declined

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  me: "champion",
  nudge: null as Row | null,
  writes: [] as Array<{ table: string; patch: Row; filters: Array<[string, unknown]> }>,
  created: 0,
  champion: true,
  opener: undefined as string | undefined,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: { id: h.me, role: "team_member", company_id: "co" } }),
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      let patch: Row | null = null;
      const filters: Array<[string, unknown]> = [];
      const b = {
        select: () => b,
        eq: (col: string, v: unknown) => (filters.push([col, v]), b),
        is: (col: string, v: unknown) => (filters.push([col, v]), b),
        update: (p: Row) => ((patch = p), b),
        maybeSingle: async () => ({ data: table === "guide_nudges" ? h.nudge : null, error: null }),
        then: (res: (v: { error: null }) => unknown) => {
          if (patch) h.writes.push({ table, patch, filters });
          return Promise.resolve({ error: null }).then(res);
        },
      };
      return b;
    },
  }),
}));
vi.mock("./champion", () => ({ isAimsChampion: async () => h.champion }));
vi.mock("@/lib/practices/resolve", () => ({ resolveAgent: async () => ({ id: "debrief-a-meeting" }) }));
vi.mock("@/lib/practices/gate", () => ({ practiceGate: async () => ({ ok: true }) }));
vi.mock("@/lib/practices/create", () => ({
  createPracticeConversation: async (_id: string, opts: { opener?: string }) => {
    h.created += 1;
    h.opener = opts.opener;
    return { ok: true, item: { id: "new-conversation" } };
  },
}));

function nudge(over: Row = {}): Row {
  return {
    id: "n1",
    company_id: "co",
    recipient_profile_id: "champion",
    meeting_id: "m1",
    state: "pending",
    conversation_id: null,
    headline: "Tuesday's scheduling clash came up twice. Want to talk it through?",
    ...over,
  };
}

beforeEach(() => {
  h.me = "champion";
  h.nudge = nudge();
  h.writes = [];
  h.created = 0;
  h.champion = true;
});

describe("openNudge", () => {
  it("opens on the first message written with the card, not the headline", async () => {
    h.nudge = nudge({ headline: "Brendon agreed to lead next week's meeting.", invitation: "What made saying yes so easy?", opener: "Jeff asked the team.\n\"We can.\"\nWhat helped?" });
    const { openNudge } = await import("./open-nudge");
    await openNudge("n1");
    expect(h.opener).toBe("Jeff asked the team.\n\"We can.\"\nWhat helped?");
  });

  it("opens on the card's own words when there is no first message", async () => {
    h.nudge = nudge({ headline: "Brendon agreed to lead next week's meeting.", invitation: "What made saying yes so easy?", opener: null });
    const { openNudge } = await import("./open-nudge");
    await openNudge("n1");
    expect(h.opener).toBe("Brendon agreed to lead next week's meeting. What made saying yes so easy?");
  });

  it("refuses anyone but the recipient, and writes nothing", async () => {
    h.me = "company-admin";
    const { openNudge } = await import("./open-nudge");
    expect(await openNudge("n1")).toEqual({ ok: false, message: "That invitation isn't yours to open." });
    expect(h.writes).toEqual([]);
    expect(h.created).toBe(0);
  });

  it("opens it for the recipient: a conversation, the nudge opened, the notification read", async () => {
    const { openNudge } = await import("./open-nudge");
    expect(await openNudge("n1")).toEqual({ ok: true, conversationId: "new-conversation" });
    expect(h.created).toBe(1);
    const nudgeWrite = h.writes.find((w) => w.table === "guide_nudges");
    expect(nudgeWrite?.patch).toMatchObject({ state: "opened", conversation_id: "new-conversation" });
    const read = h.writes.find((w) => w.table === "notifications");
    expect(read?.patch).toHaveProperty("read_at");
    expect(read?.filters).toContainEqual(["recipient_id", "champion"]);
    expect(read?.filters).toContainEqual(["payload->>nudge_id", "n1"]);
  });

  it("lands a second open on the same conversation and creates nothing", async () => {
    h.nudge = nudge({ state: "opened", conversation_id: "existing" });
    const { openNudge } = await import("./open-nudge");
    expect(await openNudge("n1")).toEqual({ ok: true, conversationId: "existing" });
    expect(h.created).toBe(0);
    expect(h.writes.map((w) => w.table)).toEqual(["notifications"]);
  });

  it("leaves a declined invitation declined", async () => {
    h.nudge = nudge({ state: "dismissed" });
    const { openNudge } = await import("./open-nudge");
    const r = await openNudge("n1");
    expect(r.ok).toBe(false);
    expect(h.created).toBe(0);
    expect(h.writes).toEqual([]);
  });

  it("says plainly when the seat has moved on, and opens nothing", async () => {
    h.champion = false;
    const { openNudge } = await import("./open-nudge");
    expect(await openNudge("n1")).toEqual({
      ok: false,
      message: "This invitation was for your company's AiMS champion, and that's no longer you.",
    });
    expect(h.created).toBe(0);
    expect(h.writes).toEqual([]);
  });
});
