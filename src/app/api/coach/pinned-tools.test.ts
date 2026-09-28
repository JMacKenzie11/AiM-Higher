import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// An agent's tools come from the version its conversation is pinned
// to, the same as its prompt, model and token ceiling. The route used
// to read the code registry's list, so a tool published in the Agent
// Hub never reached a conversation (investigation, 2026-09-28).

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn() }));

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
  requireProfile: async () => ({ profile: { id: "u1", role: "company_admin", company_id: "c1", full_name: "A" } }),
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/coach/usage", () => ({ logCoachTokenUsage: vi.fn() }));
vi.mock("@/lib/coach/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/coach/service")>()),
  getAccessForConversation: async () => "owner",
}));
// The registry's agent declares NO tools; its pinned version declares one.
vi.mock("@/lib/practices/resolve", () => ({
  resolveAgent: async () => ({ id: "some-agent", title: "Some agent", tools: [], basePromptMode: "full_coach" }),
}));
vi.mock("@/lib/practices/version-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/practices/version-config")>()),
  resolveRuntimeConfig: async () => ({
    prompt: "You are an agent.",
    basePromptMode: "full_coach",
    tools: ["get_foundation"],
    maxTokens: null,
    model: null,
    chips: [],
    skipSetup: false,
    firstTurn: null,
    scriptedOpener: null,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "is", "not", "gte", "lte", "order", "limit", "update", "delete", "upsert"]) b[m] = () => b;
      let inserted: unknown = null;
      b.insert = (payload: unknown) => ((inserted = payload), b);
      const row = () => {
        if (table === "coaching_conversations") {
          return {
            id: "conv1", created_by: "u1", company_id: "c1", practice_id: "some-agent",
            agent_version_id: "v2", debriefing_meeting_id: null, revising_role_id: null,
            mode: "general", context_kind: "execution",
          };
        }
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

function streamOf(text: string) {
  const final = { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
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
  process.env.ANTHROPIC_API_KEY = "test";
  h.stream.mockImplementation(() => streamOf("Fine."));
});

describe("an agent's tools", () => {
  it("come from the pinned version, not the code registry", async () => {
    const req = new Request("http://localhost/api/coach", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conv1", userMessage: "Hello" }),
    });
    await (await POST(req as never)).text();

    const offered = (h.stream.mock.calls[0][0].tools as Array<{ name: string }>).map((t) => t.name);
    expect(offered).toContain("get_foundation");
  });
});
