import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// One opener per conversation (route.ts, "ONE OPENER PER
// CONVERSATION"). On dev the chat page's start effect ran twice and
// the champion's debrief opened with two openers; a double click or a
// refresh mid-reply does the same in production. A second request to
// open a conversation that already has an opener gets the saved one
// back: no model call, nothing new saved.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  create: vi.fn(),
  stream: vi.fn(),
  inserts: [] as Array<{ table: string; payload: unknown }>,
  saved: null as null | { id: string; role: string; content: string },
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
      b.insert = (payload: unknown) => {
        h.inserts.push({ table, payload });
        return b;
      };
      const row = () => {
        if (table === "coaching_conversations") {
          return { id: "conv1", owner_id: "u1", practice_id: "guide-meeting-debrief", mode: "self", context_kind: null };
        }
        if (table === "coaching_messages") return h.saved;
        return null;
      };
      b.maybeSingle = async () => ({ data: row(), error: null });
      b.single = async () => ({ data: row(), error: null });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return b;
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Any model call is the failure: a second opener being written.
  h.create.mockRejectedValue(new Error("model called"));
  h.stream.mockImplementation(() => {
    throw new Error("model called");
  });
  h.inserts.length = 0;
  process.env.ANTHROPIC_API_KEY = "test";
});

// The route pulls in the whole coach stack, and importing it cold
// inside a test ran past the 5s limit under the full suite's load
// (2026-09-28): a timing failure, not a behaviour one. Loaded once,
// with its own allowance, so the test times only what it tests.
let POST: typeof import("./route").POST;
beforeAll(async () => {
  ({ POST } = await import("./route"));
}, 60_000);

const post = async () => {
  const req = new Request("http://localhost/api/coach", {
    method: "POST",
    body: JSON.stringify({ conversationId: "conv1", generateOpener: true }),
  });
  return POST(req as never);
};

describe("opening a conversation that already has an opener", () => {
  it("sends the saved opener back, calls no model, and saves nothing", async () => {
    h.saved = { id: "m1", role: "assistant", content: "You flagged you were forty minutes in." };

    const res = await post();
    const text = await res.text();

    expect(text).toContain("event: delta");
    expect(text).toContain("You flagged you were forty minutes in.");
    expect(text).toContain('"assistantMessageId":"m1"');
    expect(h.create).not.toHaveBeenCalled();
    expect(h.stream).not.toHaveBeenCalled();
    expect(h.inserts).toEqual([]);
  });
});
