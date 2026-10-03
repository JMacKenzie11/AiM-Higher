import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// A CONVERSATION STARTED IN AIMEE'S PANEL (0240, origin = 'panel').
// It never writes coach memory, so remember_this is not among its
// tools; it may still read memory. Aimee is told she is in the panel,
// with the link that starts a new conversation on the Aimee page. A
// page conversation is unchanged. And a help search is counted, with
// whether it found anything and never the query.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn(), role: "team_member", practice: null as unknown, origin: "page", inserts: [] as Array<{ table: string; payload: unknown }> }));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  return { default: class { static APIError = APIError; messages = { create: h.create, stream: h.stream }; } };
});
vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: { id: "u1", role: h.role, company_id: "c1", full_name: "A" } }),
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/coach/usage", () => ({ logCoachTokenUsage: vi.fn() }));
vi.mock("@/lib/subscriptions/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/subscriptions/service")>()),
  getCompanyFeatures: async () => ["execution", "classroom"],
  companyHasFeature: async () => false,
}));
vi.mock("@/lib/coach/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/coach/service")>()),
  getAccessForConversation: async () => "owner",
}));
vi.mock("@/lib/practices/resolve", () => ({ resolveAgent: async () => h.practice }));
// Nothing in a chat turn may read with the service role: a record the
// panel describes is read under the person's own session (Step 4).
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: async () => {
    throw new Error("the service role was used in a chat turn");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "is", "not", "gte", "lte", "order", "limit", "update", "delete", "upsert", "or", "ilike"]) b[m] = () => b;
      let inserted: unknown = null;
      b.insert = (payload: unknown) => (h.inserts.push({ table, payload }), (inserted = payload), b);
      const row = () => {
        if (table === "coaching_conversations") {
          return {
            id: "conv1", created_by: "u1", company_id: "c1", practice_id: h.practice ? "some-agent" : null,
            agent_version_id: null, debriefing_meeting_id: null, revising_role_id: null,
            mode: "general", context_kind: "execution", origin: h.origin,
          };
        }
        if (table === "coaching_messages" && inserted) return { id: "msg", ...(inserted as object) };
        return null;
      };
      b.maybeSingle = async () => ({ data: row(), error: null });
      b.single = async () => ({ data: row(), error: null });
      // The thread so far: the one message just sent, so the latest
      // user turn (where page context rides) exists.
      const list = table === "coaching_messages" ? [{ role: "user", content: "Where do I add a priority?" }] : [];
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: list, error: null }).then(res);
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

function streamOfToolUse(name: string, input: unknown) {
  const final = {
    content: [{ type: "tool_use", id: "tu1", name, input }],
    stop_reason: "tool_use",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  return {
    async *[Symbol.asyncIterator]() {},
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
  h.role = "team_member";
  h.practice = null;
  h.origin = "page";
  h.inserts = [];
});

async function send(extra: Record<string, unknown> = {}) {
  const req = new Request("http://localhost/api/coach", {
    method: "POST",
    body: JSON.stringify({ conversationId: "conv1", userMessage: "Where do I add a priority?", ...extra }),
  });
  await (await POST(req as never)).text();
  const call = h.stream.mock.calls[0][0];
  const messages = call.messages as Array<{ role: string; content: string }>;
  return {
    tools: (call.tools as Array<{ name: string }>).map((t) => t.name),
    system: (call.system as Array<{ text: string }>).map((b) => b.text).join("\n"),
    // The array is the route's own and grows after the call, so find
    // the user turn rather than taking the last entry.
    lastUser: String([...messages].reverse().find((m) => m.role === "user" && typeof m.content === "string")?.content ?? ""),
  };
}

describe("a conversation started in Aimee's panel", () => {
  // Jason, 2026-10-03: an explicit "remember that" is saved in the
  // panel too. The sweep still never distils a panel conversation
  // (panel-memory.test.ts), so this is the only write.
  it("saves what it is asked to remember, reads memory, and has no link to offer", async () => {
    h.origin = "panel";
    const { tools, system } = await send();
    expect(tools).toContain("remember_this");
    expect(tools).toContain("memory_lookup");
    expect(tools).toContain("search_help");
    expect(system).toContain("<panel>");
    expect(system).toContain("remember_this");
    // Jason, 2026-10-01: the "Continue on the Aimee page" link is not
    // offered in a panel chat any more.
    expect(system).not.toContain("Continue on the Aimee page");
    expect(system).not.toContain("/ask-aimee/new");
  });

  it("leaves a page conversation as it was: remember_this, and no panel instructions", async () => {
    const { tools, system } = await send();
    expect(tools).toContain("remember_this");
    expect(system).not.toContain("<panel>");
  });

  it("counts a help search, and whether it found anything, without the query", async () => {
    h.stream
      .mockImplementationOnce(() => streamOfToolUse("search_help", { query: "add a quarterly priority" }))
      .mockImplementation(() => streamOf("It is on Goals & Priorities."));
    await send();
    const events = h.inserts.filter((i) => i.table === "aimee_panel_events");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      company_id: "c1",
      profile_id: "u1",
      kind: "help_search",
      found: expect.any(Boolean),
    });
    expect(JSON.stringify(events[0].payload)).not.toContain("priority");
  });

  it("is told about the page beside it, and a page conversation is not", async () => {
    const pageContext = { path: "/plan", record: null };
    h.origin = "panel";
    const panel = await send({ pageContext });
    expect(panel.lastUser).toContain("<current_page>");
    expect(panel.lastUser).toContain("(/plan)");

    vi.clearAllMocks();
    h.stream.mockImplementation(() => streamOf("Fine."));
    h.origin = "page";
    const page = await send({ pageContext });
    expect(page.lastUser).not.toContain("<current_page>");
  });

  it("describes no record the session's own client did not return", async () => {
    // The fake session answers no row for a function, which is what
    // RLS does with another company's. Aimee hears the page, not the
    // record, and the service role (mocked to throw) is never asked.
    h.origin = "panel";
    const { lastUser } = await send({
      pageContext: { path: "/chart", record: { pattern: "/chart/function/[id]", id: "11111111-1111-4111-8111-111111111111" } },
    });
    expect(lastUser).toContain("<current_page>");
    expect(lastUser).not.toMatch(/Open function/);
  });
});
