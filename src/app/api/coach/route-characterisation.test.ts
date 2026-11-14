import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// WHAT A TURN DOES TODAY, PINNED BEFORE THE ROUTE IS TAKEN APART
// (2026-11-14). The Aimee review found about twenty behaviours of
// POST /api/coach that no test held: the 403 for a read-share, the
// retry that saves no second user row, the context riding on the
// latest user turn only, the cache breakpoint, the tool loop's cap
// and its error payloads, the truncated event, the first plain reply
// held back and retried, the dash strip on save, the title call.
//
// These assert the CURRENT behaviour, including two the review
// flagged as wrong (the retry sends no tools and no cache marker; a
// loop that runs out of passes saves an empty reply). A fix to either
// changes its test here on purpose, in the PR that fixes it.
//
// The composed system prompt and the tool order are pinned by hash
// per conversation shape, so a refactor that moves the composition
// must leave every hash where it was.

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  stream: vi.fn(),
  create: vi.fn(),
  practice: null as unknown,
  convo: null as Row | null,
  access: "owner" as string | null,
  history: [] as Array<{ role: string; content: string }>,
  firstAssistant: null as Row | null,
  lastUser: null as Row | null,
  inserts: [] as Array<{ table: string; payload: unknown }>,
  updates: [] as Array<{ table: string; payload: unknown }>,
  replySaveFails: 0,
}));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status = 500;
  }
  return { default: class { static APIError = APIError; messages = { create: h.create, stream: h.stream }; } };
});
vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: { id: "u1", role: "team_member", company_id: "c1", full_name: "A" } }),
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/coach/usage", () => ({ logCoachTokenUsage: vi.fn() }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/subscriptions/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/subscriptions/service")>()),
  getCompanyFeatures: async () => ["execution", "classroom"],
  companyHasFeature: async () => false,
}));
vi.mock("@/lib/coach/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/coach/service")>()),
  getAccessForConversation: async () => h.access,
}));
vi.mock("@/lib/practices/resolve", () => ({ resolveAgent: async () => h.practice }));
vi.mock("@/lib/aimee/session-offers", async (orig) => ({
  ...(await orig<typeof import("@/lib/aimee/session-offers")>()),
  offerableSessions: async () => [{ id: "prepare-a-hard-conversation", title: "Prepare a hard conversation", offerWhen: "Someone needs to raise a problem." }],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: async () => {
    throw new Error("the service role was used in a chat turn");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      const b: Record<string, unknown> = {};
      const eqs: Record<string, unknown> = {};
      let inserted: unknown = null;
      for (const m of ["select", "neq", "in", "is", "not", "gte", "lte", "order", "limit", "delete", "upsert", "or", "ilike"]) b[m] = () => b;
      b.eq = (col: string, val: unknown) => ((eqs[col] = val), b);
      b.insert = (payload: unknown) => (h.inserts.push({ table, payload }), (inserted = payload), b);
      b.update = (payload: unknown) => (h.updates.push({ table, payload }), b);
      const row = () => {
        if (table === "coaching_conversations") return h.convo;
        if (table === "coaching_messages") {
          if (inserted) return { id: `${(inserted as Row).role}-row`, ...(inserted as object) };
          if (eqs.role === "assistant") return h.firstAssistant;
          if (eqs.role === "user") return h.lastUser;
        }
        return null;
      };
      b.maybeSingle = async () => ({ data: row(), error: null });
      b.single = async () => {
        if (table === "coaching_messages" && (inserted as Row | null)?.role === "assistant" && h.replySaveFails > 0) {
          h.replySaveFails -= 1;
          return { data: null, error: { message: "refused" } };
        }
        return { data: row(), error: null };
      };
      // The route reads history newest first and reverses it.
      const list = table === "coaching_messages" ? [...h.history].reverse() : [];
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: list, error: null }).then(res);
      return b;
    },
  }),
}));

type Final = { content: unknown[]; stop_reason: string; usage: Record<string, number> };
function streamOf(final: Final, deltas: string[] = []) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of deltas) yield { type: "content_block_delta", delta: { type: "text_delta", text } };
    },
    finalMessage: async () => final,
  };
}
const usage = { input_tokens: 1, output_tokens: 1 };
const text = (t: string, stop = "end_turn") =>
  streamOf({ content: [{ type: "text", text: t }], stop_reason: stop, usage }, [t]);
const toolUse = (name: string, input: unknown = {}, lead = "") =>
  streamOf(
    { content: [...(lead ? [{ type: "text", text: lead }] : []), { type: "tool_use", id: `tu-${name}`, name, input }], stop_reason: "tool_use", usage },
    lead ? [lead] : []
  );

let POST: typeof import("./route").POST;
let TITLE_SYSTEM: string;
beforeAll(async () => {
  ({ POST } = await import("./route"));
  ({ TITLE_SYSTEM } = await import("@/lib/coach/title"));
}, 60_000);

const AGENT = { id: "some-agent", title: "Some agent", promptFile: "prompts/practices/ask-better-questions.md", basePromptMode: "voice_only", skipSetup: false, category: "People", description: "" };
const conversation = (over: Row = {}): Row => ({
  id: "conv1", created_by: "u1", company_id: "c1", practice_id: null, agent_version_id: null,
  debriefing_meeting_id: null, revising_role_id: null, subject_profile_id: null,
  mode: "general", context_kind: "execution", origin: "page", handoff_summary: null, ...over,
});
const LATER = [
  { role: "user", content: "Earlier question." },
  { role: "assistant", content: "Earlier answer." },
  { role: "user", content: "Where do I add a priority?" },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test";
  h.practice = null;
  h.convo = conversation();
  h.access = "owner";
  h.history = LATER;
  h.firstAssistant = null;
  h.lastUser = null;
  h.inserts = [];
  h.updates = [];
  h.replySaveFails = 0;
  h.stream.mockImplementation(() => text("Fine."));
  h.create.mockResolvedValue({ content: [{ type: "text", text: "A label" }], usage });
});

async function post(body: Row = {}) {
  const req = new Request("http://localhost/api/coach", {
    method: "POST",
    body: JSON.stringify({ conversationId: "conv1", userMessage: "Where do I add a priority?", ...body }),
  });
  const res = await POST(req as never);
  const raw = await res.text();
  const events = raw
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("event: "))
    .map((chunk) => {
      const [e, d] = chunk.split("\n");
      return { event: e.replace(/^event: /, ""), data: JSON.parse(d.replace(/^data: /, "")) as Row };
    });
  // Let fire-and-forget work after the stream (the title) settle.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return { status: res.status, raw, events, names: events.map((e) => e.event) };
}
const inserted = (table: string, role?: string) =>
  h.inserts.filter((i) => i.table === table && (!role || (i.payload as Row).role === role)).map((i) => i.payload as Row);
const firstCall = () => h.stream.mock.calls[0][0] as Row;

describe("who may post", () => {
  it("refuses someone the conversation was shared with to read, and a stranger, with 403", async () => {
    h.access = "read";
    expect((await post()).status).toBe(403);
    h.access = null;
    expect((await post()).status).toBe(403);
    expect(h.inserts).toHaveLength(0);
  });

  it("lets the owner and a write-share post", async () => {
    for (const a of ["owner", "write"]) {
      h.access = a;
      expect((await post()).status).toBe(200);
    }
  });

  it("answers 404 for a conversation it cannot read", async () => {
    h.convo = null;
    expect((await post()).status).toBe(404);
  });
});

describe("an ordinary turn", () => {
  it("saves the person's message first, streams the reply, saves it, and bumps the conversation", async () => {
    h.stream.mockImplementation(() => text("Use Plan.", "end_turn"));
    const { names, events } = await post();
    expect(names).toEqual(["ready", "delta", "done"]);
    expect(events[0].data).toEqual({ userMessageId: "user-row" });
    expect(inserted("coaching_messages", "user")).toHaveLength(1);
    expect(inserted("coaching_messages", "assistant")[0].content).toBe("Use Plan.");
    expect(events[2].data.assistantMessageId).toBe("assistant-row");
    expect(h.updates.some((u) => u.table === "coaching_conversations" && "updated_at" in (u.payload as Row))).toBe(true);
  });

  it("tries once more when saving the reply fails, and reports it if that fails too", async () => {
    const { reportError } = await import("@/lib/observability/report");
    h.replySaveFails = 1;
    const once = await post();
    expect(inserted("coaching_messages", "assistant")).toHaveLength(2);
    expect(once.events.at(-1)!.data.assistantMessageId).toBe("assistant-row");
    expect(reportError).not.toHaveBeenCalled();

    h.inserts = [];
    h.replySaveFails = 2;
    const twice = await post();
    expect(twice.events.at(-1)!.data.assistantMessageId).toBeNull();
    expect(reportError).toHaveBeenCalledWith("coach.reply_not_saved", expect.anything(), { conversationId: "conv1" });
  });

  it("strips em dashes from what it saves", async () => {
    h.stream.mockImplementation(() => text("Use Plan — it is there."));
    await post();
    expect(String(inserted("coaching_messages", "assistant")[0].content)).not.toContain("—");
  });

  it("on a retry saves no second copy of the person's message", async () => {
    h.lastUser = { id: "earlier-user-row", role: "user", content: "Where do I add a priority?" };
    const { events } = await post({ retry: true, userMessage: "" });
    expect(inserted("coaching_messages", "user")).toHaveLength(0);
    expect(events[0].data).toEqual({ userMessageId: "earlier-user-row" });
  });

  it("puts the context on the latest user turn only", async () => {
    await post();
    const messages = firstCall().messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "user", content: "Earlier question." });
    expect(messages[1]).toEqual({ role: "assistant", content: "Earlier answer." });
    expect(messages[2].content).toContain("<coaching_context>");
    expect(messages[2].content.endsWith("Where do I add a priority?")).toBe(true);
  });

  it("marks the system prompt for caching", async () => {
    await post();
    const system = firstCall().system as Array<Row>;
    expect(system).toHaveLength(1);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("says when a reply was cut off at the ceiling", async () => {
    h.stream.mockImplementation(() => text("Half a", "max_tokens"));
    const { names } = await post();
    expect(names).toContain("truncated");
  });

  it("sends an error event when the model call fails, and still bumps the conversation", async () => {
    h.stream.mockImplementation(() => {
      throw new Error("boom");
    });
    const { events } = await post();
    expect(events.map((e) => e.event)).toEqual(["ready", "error"]);
    expect(events[1].data.message).toBe("boom");
    expect(h.updates.some((u) => u.table === "coaching_conversations")).toBe(true);
  });
});

describe("the tool loop", () => {
  it("runs a tool, gives the model its result, and joins the text of both passes", async () => {
    h.stream
      .mockImplementationOnce(() => toolUse("about_aims", {}, "Let me check. "))
      .mockImplementation(() => text("It is on Plan."));
    const { names } = await post();
    expect(names).toEqual(["ready", "delta", "tool", "delta", "done"]);
    const second = h.stream.mock.calls[1][0].messages as Array<{ role: string; content: unknown }>;
    const results = second[second.length - 1].content as Array<Row>;
    expect(results[0].type).toBe("tool_result");
    expect(inserted("coaching_messages", "assistant")[0].content).toBe("Let me check. It is on Plan.");
  });

  it("answers an unknown tool with an error payload, never a crash", async () => {
    h.stream
      .mockImplementationOnce(() => toolUse("no_such_tool"))
      .mockImplementation(() => text("Done."));
    await post();
    const second = h.stream.mock.calls[1][0].messages as Array<{ role: string; content: unknown }>;
    const results = second[second.length - 1].content as Array<Row>;
    expect(JSON.parse(String(results[0].content))).toEqual({ status: "error", message: "unknown tool: no_such_tool" });
  });

  it("stops after four passes, and the last pass may not call a tool, so it answers", async () => {
    h.stream
      .mockImplementationOnce(() => toolUse("no_such_tool"))
      .mockImplementationOnce(() => toolUse("no_such_tool"))
      .mockImplementationOnce(() => toolUse("no_such_tool"))
      .mockImplementation(() => text("Here is what I found."));
    await post();
    expect(h.stream).toHaveBeenCalledTimes(4);
    const calls = h.stream.mock.calls.map((c) => c[0] as Row);
    expect(calls.slice(0, 3).every((c) => c.tool_choice === undefined)).toBe(true);
    expect(calls[3].tool_choice).toEqual({ type: "none" });
    expect(calls[3].tools).toBeDefined();
    expect(inserted("coaching_messages", "assistant")[0].content).toBe("Here is what I found.");
  });
});

describe("the first reply in plain Aimee", () => {
  beforeEach(() => {
    h.history = [{ role: "user", content: "Where do I add a priority?" }];
  });

  it("is held back and shown whole once checked", async () => {
    h.stream.mockImplementation(() => text("What are you trying to plan?"));
    const { names, events } = await post();
    expect(names).toEqual(["ready", "delta", "done"]);
    expect(events[1].data.text).toBe("What are you trying to plan?");
    expect(h.create.mock.calls.filter((c) => (c[0] as Row).system !== TITLE_SYSTEM)).toHaveLength(0);
  });

  it("is sent back once when it breaks a rule, and the better answer is kept", async () => {
    h.stream.mockImplementation(() => text("What are you planning? Who is it for?"));
    h.create.mockImplementation(async (args: Row) =>
      args.system === TITLE_SYSTEM
        ? { content: [{ type: "text", text: "A label" }], usage }
        : { content: [{ type: "text", text: "What are you planning?" }], usage }
    );
    const { events } = await post();
    const retry = h.create.mock.calls.map((c) => c[0] as Row).find((a) => a.system !== TITLE_SYSTEM)!;
    expect(retry).toBeDefined();
    // Today the retry carries no tools and no cache marker.
    expect(retry.tools).toBeUndefined();
    expect((retry.system as Array<Row>)[0].cache_control).toBeUndefined();
    expect(events.find((e) => e.event === "delta")!.data.text).toBe("What are you planning?");
    expect(inserted("coaching_messages", "assistant")[0].content).toBe("What are you planning?");
  });

  it("leaves a name the person gave it while the reply was arriving", async () => {
    h.convo = conversation({ title: "Budget talk" });
    await post();
    expect(h.updates.some((u) => "title" in (u.payload as Row))).toBe(false);
  });

  it("names the conversation after the first exchange, from the bare exchange", async () => {
    h.convo = conversation({ title: "Coaching · Nov 14" });
    await post();
    const title = h.create.mock.calls.map((c) => c[0] as Row).find((a) => a.system === TITLE_SYSTEM);
    expect(title).toBeDefined();
    const msgs = title!.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]).toEqual({ role: "user", content: "Where do I add a priority?" });
    expect(h.updates.some((u) => (u.payload as Row).title === "A label")).toBe(true);
  });
});

describe("an opener", () => {
  it("sends back the saved opener rather than writing a second", async () => {
    h.firstAssistant = { id: "opener-row", role: "assistant", content: "Hello again." };
    const { names, events } = await post({ generateOpener: true, userMessage: "" });
    expect(names).toEqual(["delta", "done"]);
    expect(events[0].data.text).toBe("Hello again.");
    expect(h.stream).not.toHaveBeenCalled();
  });
});

// The system prompt and tool list each shape is sent, by hash. A
// refactor that moves composition around must leave these unchanged;
// a deliberate prompt change updates the snapshot in its own PR.
describe("what each kind of conversation is sent", () => {
  const shapes: Record<string, () => void> = {
    "plain Aimee on the page": () => {},
    "plain Aimee in the panel": () => (h.convo = conversation({ origin: "panel" })),
    "about a person": () => (h.convo = conversation({ mode: "about", subject_profile_id: "s1" })),
    "an agent": () => {
      h.practice = AGENT;
      h.convo = conversation({ practice_id: "some-agent" });
    },
  };
  for (const [name, setup] of Object.entries(shapes)) {
    it(name, async () => {
      setup();
      await post();
      const call = firstCall();
      const system = (call.system as Array<{ text: string }>).map((b) => b.text).join("\n");
      const tools = (call.tools as Array<{ name: string }>).map((t) => t.name);
      // Nothing in the system prompt may change by the day, or the
      // cache misses and this hash rots overnight.
      expect(system).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}\b/);
      expect({
        system: createHash("sha256").update(system).digest("hex").slice(0, 16),
        systemChars: system.length,
        tools,
      }).toMatchSnapshot();
    });
  }
});
