import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// A debrief reply is held back, checked, and retried before anybody
// reads it (route.ts, "TURNS HELD BACK AND CHECKED"). On dev every
// debrief reply broke a countable rule, invented quotes included.
// Pinned here: the reader never sees the first draft, and what is
// shown and saved is the corrected reply.

vi.mock("server-only", () => ({}));

const TRANSCRIPT = "Speaker 1: Is it ours?\n\nSpeaker 2: Partly. About half of it is genuinely on us.";
const DRAFT = 'It started from "is it ours", not "how much do they want this time", and that set the tone.';
const FIXED = 'It started from "is it ours", and that set the tone. Who tells the crew?';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  stream: vi.fn(),
  inserts: [] as Array<{ table: string; payload: unknown }>,
}));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  return {
    default: class {
      static APIError = APIError;
      messages = { create: h.create, stream: h.stream };
    },
  };
});
vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: { id: "u1", role: "team_member", company_id: "c1" } }),
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/coach/usage", () => ({ logCoachTokenUsage: vi.fn() }));
vi.mock("@/lib/coach/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/coach/service")>()),
  getAccessForConversation: async () => "owner",
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "is", "not", "gte", "lte", "order", "limit", "update", "delete", "upsert"]) b[m] = () => b;
      let inserted: unknown = null;
      b.insert = (payload: unknown) => {
        h.inserts.push({ table, payload });
        inserted = payload;
        return b;
      };
      const row = () => {
        if (table === "coaching_conversations") {
          return {
            id: "conv1",
            created_by: "u1",
            company_id: "c1",
            practice_id: "guide-meeting-debrief",
            debriefing_meeting_id: "m1",
            revising_role_id: null,
            mode: "general",
            context_kind: "execution",
          };
        }
        if (table === "meetings") return { transcript_text: TRANSCRIPT };
        if (table === "coaching_messages" && inserted) return { id: "msg", ...(inserted as object) };
        return null;
      };
      b.maybeSingle = async () => ({ data: row(), error: null });
      b.single = async () => ({ data: row(), error: null });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return b;
    },
  }),
}));

// A stream that yields the draft as deltas and ends the turn.
function streamOf(text: string) {
  const final = {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "content_block_delta", delta: { type: "text_delta", text } };
    },
    finalMessage: async () => final,
  };
}

let POST: typeof import("./route").POST;
beforeAll(async () => {
  ({ POST } = await import("./route"));
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  h.inserts.length = 0;
  process.env.ANTHROPIC_API_KEY = "test";
  h.stream.mockImplementation(() => streamOf(DRAFT));
  h.create.mockResolvedValue({ content: [{ type: "text", text: FIXED }], usage: {} });
});

describe("a debrief reply", () => {
  it("is checked and corrected before the reader sees any of it", async () => {
    const req = new Request("http://localhost/api/coach", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conv1", userMessage: "Sure" }),
    });
    const text = await (await POST(req as never)).text();

    const deltas = [...text.matchAll(/event: delta\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]).text);
    expect(deltas).toEqual([FIXED]);
    expect(text).not.toContain("how much do they want this time");
    // The retry was told what was wrong.
    const retryTurn = h.create.mock.calls[0][0].messages.at(-1).content as string;
    expect(retryTurn).toContain('You quoted "how much do they want this time"');
    // What is saved is what was shown.
    const saved = h.inserts.filter((i) => i.table === "coaching_messages").map((i) => (i.payload as { role: string; content: string }));
    expect(saved.find((m) => m.role === "assistant")?.content).toBe(FIXED);
  });
});
