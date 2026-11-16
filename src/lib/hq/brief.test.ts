import { describe, it, expect, beforeEach, vi } from "vitest";

// The session brief reads the company's last coaching call (0326), on
// the coach's own client, and a brief that read one is shown only to
// people who can read that call.

const h = vi.hoisted(() => ({
  create: vi.fn(),
  inserted: [] as Array<Record<string, unknown>>,
  // What the caller's client returns per table and kind asked for.
  teamMeeting: { id: "team-1", meeting_title: "Weekly", file_name: "w.txt", created_at: "2026-11-10T15:00:00Z" } as Record<string, unknown> | null,
  call: { id: "call-1", meeting_title: "Call with Sam", file_name: "c.txt", created_at: "2026-11-12T15:00:00Z" } as Record<string, unknown> | null,
  analyses: { "team-1": "## Summary\nThe team met.", "call-1": "## Summary\nSam will cut to three priorities." } as Record<string, string>,
  briefs: [] as Array<Record<string, unknown>>,
  readableMeetings: new Set<string>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: h.create }; } }));
vi.mock("@/lib/coach/usage", () => ({ usageLogger: () => () => {} }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/maturity/service", () => ({ loadCompanyScorecard: async () => null }));
vi.mock("@/lib/hq/attention", () => ({ computeAttentionForCompanies: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const f: Record<string, unknown> = {};
      let ids: string[] = [];
      const b: Record<string, unknown> = {};
      for (const k of ["select", "order", "limit", "gte", "is"]) b[k] = () => b;
      b.eq = (k: string, v: unknown) => ((f[k] = v), b);
      b.in = (_k: string, v: string[]) => ((ids = v), b);
      b.insert = (row: Record<string, unknown>) => {
        h.inserted.push(row);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: "brief-new" }, error: null }) }) };
      };
      const result = () => {
        if (table === "companies") return { data: { id: "co1", name: "Ridgeline" } };
        if (table === "meetings" && f.kind === "team") return { data: h.teamMeeting };
        if (table === "meetings" && f.kind === "coaching") return { data: h.call };
        if (table === "meetings") return { data: ids.filter((i) => h.readableMeetings.has(i)).map((id) => ({ id })) };
        if (table === "meeting_analyses") return { data: { analysis_markdown: h.analyses[f.meeting_id as string] ?? null } };
        if (table === "session_briefs") return { data: h.briefs };
        return { data: [] };
      };
      b.maybeSingle = async () => result();
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
      return b;
    },
  }),
}));

import { generateSessionBrief, loadRecentBriefs } from "./brief";

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  h.create.mockReset();
  h.create.mockResolvedValue({ content: [{ type: "text", text: "### What happened last time\nGood." }] });
  h.inserted = [];
  h.call = { id: "call-1", meeting_title: "Call with Sam", file_name: "c.txt", created_at: "2026-11-12T15:00:00Z" };
});

describe("the session brief and the last coaching call", () => {
  it("reads the last coaching call's summary and starts from it", async () => {
    const res = await generateSessionBrief("co1", "coach-1");
    expect(res.ok).toBe(true);
    const sent = h.create.mock.calls[0][0] as { messages: Array<{ content: string }>; system: string };
    expect(sent.messages[0].content).toContain("## Last coaching call\nCall with Sam (2026-11-12)");
    expect(sent.messages[0].content).toContain("Sam will cut to three priorities.");
    expect(sent.system).toContain("start from where that call left off");
    expect(h.inserted[0]).toMatchObject({ based_on_meeting_id: "call-1" });
  });

  it("asks for three opening questions, under the house voice rules", async () => {
    await generateSessionBrief("co1", "coach-1");
    const sent = h.create.mock.calls[0][0] as { system: string };
    expect(sent.system).toContain("### Three questions to open with");
    expect(sent.system).toContain("exactly three questions");
    expect(sent.system).toContain("Never use em-dashes");
    expect(sent.system).not.toContain("—");
  });

  it("without a call it reads (no call, or RLS refused it), the brief is as before", async () => {
    h.call = null;
    await generateSessionBrief("co1", "coach-1");
    const sent = h.create.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(sent.messages[0].content).not.toContain("Last coaching call");
    expect(h.inserted[0]).toMatchObject({ based_on_meeting_id: "team-1" });
  });
});

describe("who sees a brief that read a coaching call", () => {
  const brief = (id: string, based: string | null) => ({
    id, company_id: "co1", generated_by: "coach-1", content_markdown: id, based_on_meeting_id: based, created_at: "2026-11-12",
  });

  it("is left out for a viewer who cannot read the call", async () => {
    h.briefs = [brief("on-call", "call-1"), brief("on-team", "team-1"), brief("on-none", null)];
    h.readableMeetings = new Set(["team-1"]);
    expect((await loadRecentBriefs("co1", 5)).map((b) => b.id)).toEqual(["on-team", "on-none"]);
  });

  it("is shown to the call's coach", async () => {
    h.readableMeetings = new Set(["team-1", "call-1"]);
    expect((await loadRecentBriefs("co1", 5)).map((b) => b.id)).toEqual(["on-call", "on-team", "on-none"]);
  });
});
