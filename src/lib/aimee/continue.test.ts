import { beforeEach, describe, expect, it, vi } from "vitest";

// "CONTINUE ON THE AIMEE PAGE" CARRIES THE PANEL CONVERSATION OVER.
//
// The new conversation opens with a summary of what the person said in
// the panel, as Aimee's first message. What has to hold:
//
//   - only their own panel conversation is read; anyone else's id, a
//     page conversation or an agent one gets a plain new conversation
//   - only what the PERSON said reaches the model
//   - a summary that breaks a voice rule is sent back once; a second
//     failure opens without a summary rather than with a bad one
//   - em dashes never reach the page

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  source: null as Row | null,
  messages: [] as Row[],
  inserts: [] as Row[],
  replies: [] as string[],
  asked: [] as string[],
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: { id: "me", role: "team_member", company_id: "co" } }),
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/coach/usage", () => ({ logCoachTokenUsage: async () => {} }));
vi.mock("@/lib/coach/create-general", () => ({
  createGeneralConversation: async () => ({ ok: true, item: { id: "new-page-conversation", company_id: "co" } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push([c, v]), b),
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: table === "coaching_conversations" ? h.source : null, error: null }),
        insert: async (row: Row) => {
          h.inserts.push({ table, ...row });
          return { error: null };
        },
        then: (res: (v: unknown) => unknown) => {
          const role = filters.find(([c]) => c === "role")?.[1];
          const rows = h.messages.filter((m) => !role || m.role === role);
          return Promise.resolve({ data: rows, error: null }).then(res);
        },
      };
      return b;
    },
  }),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (req: { messages: Array<{ content: string }> }) => {
        h.asked.push(req.messages[0].content);
        const text = h.replies.shift() ?? "";
        return { content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10 } };
      },
    };
  },
}));

const PANEL = "11111111-1111-4111-8111-111111111111";
const panelConversation = (over: Row = {}): Row => ({
  id: PANEL,
  created_by: "me",
  origin: "panel",
  mode: "general",
  practice_id: null,
  ...over,
});

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  h.source = panelConversation();
  h.messages = [
    { role: "user", content: "Marcus keeps missing the Thursday deadline." },
    { role: "assistant", content: "AIMEE SAID THIS: what have you tried so far?" },
    { role: "user", content: "I haven't raised it yet, I want to do it this week." },
  ];
  h.inserts = [];
  h.replies = [];
  h.asked = [];
});

describe("continueFromPanel", () => {
  it("opens the new conversation with a summary of what the person said", async () => {
    h.replies = ["You said Marcus keeps missing the Thursday deadline — and you want to raise it this week.\n\nWhere do you want to start?"];
    const { continueFromPanel } = await import("./continue");
    const r = await continueFromPanel(PANEL);
    expect(r).toEqual({ ok: true, conversationId: "new-page-conversation", summarized: true });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({ table: "coaching_messages", conversation_id: "new-page-conversation", role: "assistant" });
    // Em dashes never reach the page.
    expect(String(h.inserts[0].content)).not.toMatch(/[—–]/);
    // Only the person's words went to the model, not Aimee's replies.
    expect(h.asked[0]).toContain("Marcus keeps missing");
    expect(h.asked[0]).not.toContain("AIMEE SAID THIS");
  });

  it("gives anyone else's conversation, a page one or an agent one a plain new conversation", async () => {
    const { continueFromPanel } = await import("./continue");
    for (const source of [
      panelConversation({ created_by: "someone-else" }),
      panelConversation({ origin: "page" }),
      panelConversation({ practice_id: "debrief-a-meeting" }),
      null,
    ]) {
      h.source = source;
      h.inserts = [];
      const r = await continueFromPanel(PANEL);
      expect(r).toEqual({ ok: true, conversationId: "new-page-conversation", summarized: false });
      expect(h.inserts).toEqual([]);
    }
    expect(h.asked).toEqual([]);
  });

  it("sends a quote they never said back once, and uses the second attempt", async () => {
    h.replies = [
      'You told me "he is completely useless and I give up on him".\n\nWhere do you want to start?',
      "You said Marcus keeps missing the Thursday deadline, and you want to raise it this week.\n\nWhere do you want to start?",
    ];
    const { continueFromPanel } = await import("./continue");
    const r = await continueFromPanel(PANEL);
    expect(r).toMatchObject({ summarized: true });
    expect(h.asked).toHaveLength(2);
    expect(String(h.inserts[0].content)).not.toContain("useless");
  });

  it("opens without a summary when both attempts break a rule", async () => {
    h.replies = [
      'You said "he is completely useless and I give up on him".',
      'You said "he is completely useless and I give up on him".',
    ];
    const { continueFromPanel } = await import("./continue");
    const r = await continueFromPanel(PANEL);
    expect(r).toEqual({ ok: true, conversationId: "new-page-conversation", summarized: false });
    expect(h.inserts).toEqual([]);
  });

  it("only accepts a conversation id", async () => {
    const { isConversationId } = await import("./continue");
    expect(isConversationId(PANEL)).toBe(true);
    expect(isConversationId("1 or 1=1")).toBe(false);
  });
});
