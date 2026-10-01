import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Plain Aimee (a general conversation with no agent) knows the app: the
// pages this person can open, in her instructions, and search_help. The
// role comes from the session, so a team member's Aimee is never told
// about admin pages. An agent conversation gets neither.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn(), role: "team_member", practice: null as unknown }));

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
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "is", "not", "gte", "lte", "order", "limit", "update", "delete", "upsert", "or", "ilike"]) b[m] = () => b;
      let inserted: unknown = null;
      b.insert = (payload: unknown) => ((inserted = payload), b);
      const row = () => {
        if (table === "coaching_conversations") {
          return {
            id: "conv1", created_by: "u1", company_id: "c1", practice_id: h.practice ? "some-agent" : null,
            agent_version_id: null, debriefing_meeting_id: null, revising_role_id: null,
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
  h.role = "team_member";
  h.practice = null;
});

async function send() {
  const req = new Request("http://localhost/api/coach", {
    method: "POST",
    body: JSON.stringify({ conversationId: "conv1", userMessage: "Where do I add a priority?" }),
  });
  await (await POST(req as never)).text();
  const call = h.stream.mock.calls[0][0];
  return {
    tools: (call.tools as Array<{ name: string }>).map((t) => t.name),
    system: (call.system as Array<{ text: string }>).map((b) => b.text).join("\n"),
  };
}

describe("plain Aimee and the app's help", () => {
  it("gets search_help and the pages this person can open, and a team member's has no admin pages", async () => {
    const { tools, system } = await send();
    expect(tools).toContain("search_help");
    expect(system).toContain("<app_pages>");
    expect(system).toContain("(/plan)");
    expect(system).not.toMatch(/\(\/admin|\(\/hq\)|\(\/portfolio\)/);
  });

  it("is told a team member's role, and to send them to their admin rather than give admin steps", async () => {
    const { system } = await send();
    expect(system).toContain("This person is a team member.");
    expect(system).toMatch(/don't give the steps and don't describe tools they can't use/);
    expect(system).toContain("their company admin");
  });

  it("tells a system admin about the Agent Hub", async () => {
    h.role = "system_admin";
    const { system } = await send();
    expect(system).toContain("(/admin/agents)");
  });

  it("gives an agent conversation neither", async () => {
    const { PRACTICES } = await import("@/lib/practices/registry");
    h.practice = PRACTICES.find((p) => p.id === "prepare-a-hard-conversation");
    const { tools, system } = await send();
    expect(tools).not.toContain("search_help");
    expect(system).not.toContain("<app_pages>");
  });
});
