import { describe, it, expect, vi, beforeEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("server-only", () => ({}));
vi.mock("./headline", () => ({ generateHeadline: vi.fn(async () => "Your team found the real cause. Worth five minutes?") }));

// Raising a Guide invitation clears every earlier one still in the
// bell. Before, only the invitations of PENDING nudges were cleared,
// so one opened by a direct link (never marked read, never pending
// again) stayed forever: eleven piled up in a champion's bell on dev.

type Notif = { id: string; kind: string; company_id: string; recipient_id: string; read_at: string | null };

function fakeAdmin(notifications: Notif[]) {
  const inserted: Array<{ table: string; row: unknown }> = [];
  return {
    inserted,
    from(table: string) {
      const filters: Array<[string, unknown, "eq" | "is"]> = [];
      let op: "select" | "update" | "insert" = "select";
      let patch: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.limit = () => b;
      b.eq = (k: string, v: unknown) => (filters.push([k, v, "eq"]), b);
      b.is = (k: string, v: unknown) => (filters.push([k, v, "is"]), b);
      b.update = (p: Record<string, unknown>) => ((op = "update"), (patch = p), b);
      b.insert = (row: unknown) => ((op = "insert"), inserted.push({ table, row }), b);
      const run = () => {
        if (table === "notifications" && op === "update") {
          for (const n of notifications) {
            const hit = filters.every(([k, v]) => (n as Record<string, unknown>)[k] === v);
            if (hit) Object.assign(n, patch);
          }
          return { data: null, error: null };
        }
        if (table === "guide_nudges" && op === "update") return { data: [], error: null };
        if (table === "guide_nudges" && op === "insert") return { data: { id: "nudge_new" }, error: null };
        if (table === "notifications" && op === "insert") return { data: null, error: null };
        if (table === "companies") return { data: { name: "Fixture Co", aims_champion_profile_id: "champ" }, error: null };
        if (table === "agents") return { data: { slug: "guide-meeting-debrief", archived: false }, error: null };
        if (table === "profiles") return { data: { full_name: "E2E Team Member" }, error: null };
        return { data: null, error: null };
      };
      b.maybeSingle = async () => run();
      b.single = async () => run();
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res);
      return b;
    },
  };
}

const input = {
  model: "test",
  companyId: "co1",
  meetingId: "m1",
  meetingDateIso: "2026-09-28",
  analysisMarkdown: "",
  transcript: "",
  strengths: [],
};

beforeEach(() => vi.clearAllMocks());

describe("raising a Guide invitation", () => {
  it("clears every earlier invitation for the company, however its nudge ended, and nothing else", async () => {
    const notifications: Notif[] = [
      // Opened by a direct link: its nudge is "opened", not pending.
      { id: "opened_by_link", kind: "guide-nudge", company_id: "co1", recipient_id: "champ", read_at: null },
      { id: "former_champion", kind: "guide-nudge", company_id: "co1", recipient_id: "someone_else", read_at: null },
      { id: "other_company", kind: "guide-nudge", company_id: "co2", recipient_id: "champ", read_at: null },
      { id: "a_share", kind: "chat_shared", company_id: "co1", recipient_id: "champ", read_at: null },
    ];
    const admin = fakeAdmin(notifications);
    const { raiseMeetingDebriefNudge } = await import("./nudges");

    const res = await raiseMeetingDebriefNudge(admin as never, {} as Anthropic, input);

    expect(res.raised).toBe(true);
    const read = Object.fromEntries(notifications.map((n) => [n.id, n.read_at !== null]));
    expect(read).toEqual({ opened_by_link: true, former_champion: true, other_company: false, a_share: false });
    // The new invitation is inserted after the sweep, so it stays unread.
    expect(admin.inserted.some((i) => i.table === "notifications")).toBe(true);
  });
});
