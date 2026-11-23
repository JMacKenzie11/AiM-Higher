import { beforeEach, describe, expect, it, vi } from "vitest";

// OPENING A GUIDE INVITATION, from the panel or the nudge page: one
// function, so the two cannot drift (open-nudge.ts). What has to hold:
//
//   - only the recipient opens it, and a refusal writes nothing
//   - one already opened lands on its conversation, creating nothing
//   - one never opened is retired (0329): it says so, and opens and
//     writes nothing

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  me: "champion",
  nudge: null as Row | null,
  writes: [] as Array<{ table: string; patch: Row; filters: Array<[string, unknown]> }>,
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
});

describe("openNudge", () => {
  it("refuses anyone but the recipient, and writes nothing", async () => {
    h.me = "company-admin";
    const { openNudge } = await import("./open-nudge");
    expect(await openNudge("n1")).toEqual({ ok: false, message: "That invitation isn't yours to open." });
    expect(h.writes).toEqual([]);
  });

  it("lands an invitation already opened on its conversation and creates nothing", async () => {
    h.nudge = nudge({ state: "opened", conversation_id: "existing" });
    const { openNudge } = await import("./open-nudge");
    expect(await openNudge("n1")).toEqual({ ok: true, conversationId: "existing" });
    expect(h.writes.map((w) => w.table)).toEqual(["notifications"]);
  });

  it("says invitations have stopped for one never opened, and writes nothing", async () => {
    const { openNudge } = await import("./open-nudge");
    expect(await openNudge("n1")).toEqual({
      ok: false,
      message: "Aimee no longer sends these invitations. Company admins and coaches can still debrief a meeting on Ask Aimee.",
    });
    expect(h.writes).toEqual([]);
  });
});
