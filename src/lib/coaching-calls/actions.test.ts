import { describe, it, expect, beforeEach, vi } from "vitest";

// Sorting a coach's calls (0326): a call is filed only into a company
// the coach is an assigned coach of, only from the coach's own folder,
// and the database write goes through the coach's own client.

const m = vi.hoisted(() => ({
  assigned: new Set<string>(),
  folder: { id: "src-own", scope: "coach", owner_profile_id: "coach-1" } as Record<string, unknown> | null,
  call: { id: "call-1", company_id: null, status: "unrouted", source_id: "src-own" } as Record<string, unknown> | null,
  updates: [] as Array<{ table: string; patch: unknown }>,
  inserts: [] as Array<{ table: string; row: unknown }>,
  processed: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn() }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/auth/current-user", () => ({
  requireRole: async () => ({ profile: { id: "coach-1", role: "aims_guide", company_id: null } }),
}));
vi.mock("./access", () => ({ isAssignedCoach: async (id: string) => m.assigned.has(id) }));
vi.mock("@/lib/transcripts/ingest", () => ({
  ingestSource: vi.fn(),
  processPendingMeetings: async ({ meetingId }: { meetingId: string }) => {
    m.processed.push(meetingId);
    return { processed: 1, recovered: 0 };
  },
}));
vi.mock("@/lib/connections/vault", () => ({ removeCoachConnectionAsService: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: async () => ({ from: () => ({ delete: () => ({ eq: async () => ({}) }) }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const k of ["select", "eq", "is", "not", "order", "limit"]) b[k] = () => b;
      b.maybeSingle = async () => ({ data: table === "transcript_sources" ? m.folder : m.call });
      b.update = (patch: unknown) => {
        m.updates.push({ table, patch });
        return { eq: () => ({ select: async () => ({ data: [{ id: "call-1" }], error: null }) }) };
      };
      b.insert = async (row: unknown) => {
        m.inserts.push({ table, row });
        return { error: null };
      };
      return b;
    },
  }),
}));

import { fileCoachingCallAction, moveCoachingCallAction, setAsideCoachingCallAction } from "./actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  m.assigned = new Set(["co-ridgeline"]);
  m.folder = { id: "src-own", scope: "coach", owner_profile_id: "coach-1" };
  m.call = { id: "call-1", company_id: null, status: "unrouted", source_id: "src-own" };
  m.updates = [];
  m.inserts = [];
  m.processed = [];
});

describe("filing a call from Calls to sort", () => {
  it("files into a company the coach coaches, adds the name, and analyses it", async () => {
    const res = await fileCoachingCallAction(
      form({ meeting_id: "call-1", company_id: "co-ridgeline", add_alias: "on", alias: "Benson" })
    );
    expect(res).toEqual({ ok: true, message: 'Filed. "Benson" now matches this company.' });
    expect(m.updates).toEqual([
      { table: "meetings", patch: { company_id: "co-ridgeline", status: "pending", routed_by_alias: null, routed_by_person_id: null } },
    ]);
    expect(m.inserts).toEqual([{ table: "transcript_aliases", row: { company_id: "co-ridgeline", alias: "Benson" } }]);
    expect(m.processed).toEqual(["call-1"]);
  });

  it("never files into a company the coach does not coach", async () => {
    const res = await fileCoachingCallAction(form({ meeting_id: "call-1", company_id: "co-elsewhere" }));
    expect(res.ok).toBe(false);
    expect(m.updates).toEqual([]);
    expect(m.inserts).toEqual([]);
  });

  it("refuses a call that isn't in the coach's own folder", async () => {
    m.call = null;
    const res = await fileCoachingCallAction(form({ meeting_id: "call-1", company_id: "co-ridgeline" }));
    expect(res).toEqual({ ok: false, message: "That call isn't in your folder." });
    expect(m.updates).toEqual([]);
  });

  it("refuses when the coach has no folder at all", async () => {
    m.folder = null;
    const res = await fileCoachingCallAction(form({ meeting_id: "call-1", company_id: "co-ridgeline" }));
    expect(res.ok).toBe(false);
    expect(m.updates).toEqual([]);
  });

  it("sets a call aside with its words removed", async () => {
    const res = await setAsideCoachingCallAction("call-1");
    expect(res).toEqual({ ok: true });
    expect(m.updates).toEqual([
      { table: "meetings", patch: { status: "failed", error: "dismissed", transcript_text: "" } },
    ]);
  });
});

describe("moving an auto-filed call", () => {
  it("moves between two companies the coach coaches, and analyses again", async () => {
    m.assigned = new Set(["co-ridgeline", "co-harbor"]);
    m.call = { id: "call-1", company_id: "co-ridgeline", status: "complete", source_id: "src-own" };
    const res = await moveCoachingCallAction(form({ meeting_id: "call-1", company_id: "co-harbor" }));
    expect(res.ok).toBe(true);
    expect(m.updates[0]).toMatchObject({ table: "meetings", patch: { company_id: "co-harbor", status: "pending" } });
    expect(m.processed).toEqual(["call-1"]);
  });

  it("refuses a company the coach does not coach", async () => {
    m.call = { id: "call-1", company_id: "co-ridgeline", status: "complete", source_id: "src-own" };
    const res = await moveCoachingCallAction(form({ meeting_id: "call-1", company_id: "co-elsewhere" }));
    expect(res.ok).toBe(false);
    expect(m.updates).toEqual([]);
  });
});
