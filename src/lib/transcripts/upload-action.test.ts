import { describe, it, expect, beforeEach, vi } from "vitest";

// uploadTranscriptAction: who may upload, which company it lands in,
// and what the meeting row looks like.

const m = vi.hoisted(() => ({
  profile: { id: "p1", role: "team_member", company_id: "co1" } as Record<string, unknown>,
  companyId: "co1" as string | null,
  champion: false,
  existing: null as { id: string } | null,
  inserted: [] as Array<Record<string, unknown>>,
  processed: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn() }));
vi.mock("@/lib/auth/current-user", () => ({ requireProfile: async () => ({ profile: m.profile }) }));
vi.mock("@/lib/admin/scope", () => ({ getEffectiveCompanyId: async () => m.companyId }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/guide/champion", () => ({ isAimsChampion: async () => m.champion }));
vi.mock("./ingest", () => ({
  processPendingMeetings: async ({ meetingId }: { meetingId: string }) => {
    m.processed.push(meetingId);
    return { processed: 1, recovered: 0 };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: async () => ({
    from: (table: string) => {
      if (table === "companies") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "America/New_York" } }) }) }) };
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.existing }) }) }) }),
        insert: (row: Record<string, unknown>) => {
          m.inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "meet1" }, error: null }) }) };
        },
      };
    },
  }),
}));

import { uploadTranscriptAction } from "./upload-action";

function form(fields: Record<string, string | File>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  m.profile = { id: "p1", role: "team_member", company_id: "co1" };
  m.companyId = "co1";
  m.champion = false;
  m.existing = null;
  m.inserted = [];
  m.processed = [];
});

describe("uploadTranscriptAction", () => {
  it("refuses a team member who is not the champion, before writing", async () => {
    const res = await uploadTranscriptAction(null, form({ transcript_text: "hello" }));
    expect(res?.ok).toBe(false);
    expect(m.inserted).toHaveLength(0);
  });

  it("refuses a company admin of another company", async () => {
    m.profile = { id: "p1", role: "company_admin", company_id: "other" };
    const res = await uploadTranscriptAction(null, form({ transcript_text: "hello" }));
    expect(res?.ok).toBe(false);
    expect(m.inserted).toHaveLength(0);
  });

  it("admits the champion and writes a pending meeting in the scoped company", async () => {
    m.champion = true;
    const res = await uploadTranscriptAction(
      null,
      form({ transcript_text: "Weekly leadership\n00:00 Speaker 1 hi", meeting_date: "2020-01-02" })
    );
    expect(res).toEqual({ ok: true, title: "Weekly leadership" });
    expect(m.inserted).toHaveLength(1);
    const row = m.inserted[0];
    expect(row.company_id).toBe("co1");
    expect(row.status).toBe("pending");
    expect(row.source_id).toBeNull();
    expect(String(row.provider_file_id)).toMatch(/^upload:[0-9a-f]{64}$/);
    expect(row.created_at).toBe("2020-01-02T17:00:00.000Z");
    expect(m.processed).toEqual(["meet1"]);
  });

  it("admits a company admin of this company", async () => {
    m.profile = { id: "p1", role: "company_admin", company_id: "co1" };
    const res = await uploadTranscriptAction(null, form({ transcript_text: "hello there" }));
    expect(res?.ok).toBe(true);
  });

  it("refuses a duplicate", async () => {
    m.champion = true;
    m.existing = { id: "old" };
    const res = await uploadTranscriptAction(null, form({ transcript_text: "hello" }));
    expect(res).toEqual({ ok: false, message: "This transcript is already in Meeting Summaries." });
    expect(m.inserted).toHaveLength(0);
  });

  it("refuses a future date and an unknown file type", async () => {
    m.champion = true;
    expect((await uploadTranscriptAction(null, form({ transcript_text: "x", meeting_date: "2999-01-01" })))?.ok).toBe(false);
    const pdf = new File(["x"], "notes.pdf", { type: "application/pdf" });
    expect(await uploadTranscriptAction(null, form({ transcript_file: pdf }))).toEqual({
      ok: false,
      message: "Upload a .docx, .txt or .vtt file.",
    });
    expect(m.inserted).toHaveLength(0);
  });
});
