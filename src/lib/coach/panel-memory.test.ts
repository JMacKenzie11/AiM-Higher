import { beforeEach, describe, expect, it, vi } from "vitest";

// A CONVERSATION STARTED IN AIMEE'S PANEL NEVER WRITES COACH MEMORY
// (docs/investigations/aimee-panel.md, "Coach memory in the panel").
//
// Run through the real sweep, with the database and the model faked:
// two finished plain Aimee conversations, alike in every way but where
// they were started. The page one must be distilled and written, so
// this cannot pass by the memory path simply being broken; the panel
// one must leave memory exactly as it was.

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ fn: string; args: Row }>,
  modelCalls: 0,
}));

// Just enough of the query builder for the sweep: filters are applied
// to the rows, so a filter the code forgets is a row it gets back.
function query(table: string) {
  let rows = [...(state.tables[table] ?? [])];
  let pendingUpdate: Row | null = null;
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: (n: number) => {
      rows = rows.slice(0, n);
      return builder;
    },
    eq: (col: string, v: unknown) => {
      rows = rows.filter((r) => r[col] === v);
      if (pendingUpdate) for (const r of rows) Object.assign(r, pendingUpdate);
      return builder;
    },
    neq: (col: string, v: unknown) => {
      rows = rows.filter((r) => r[col] !== v);
      return builder;
    },
    is: (col: string, v: unknown) => {
      rows = rows.filter((r) => (r[col] ?? null) === v);
      return builder;
    },
    in: (col: string, vs: unknown[]) => {
      rows = rows.filter((r) => vs.includes(r[col]));
      return builder;
    },
    gt: (col: string, v: string) => {
      rows = rows.filter((r) => String(r[col]) > v);
      return builder;
    },
    update: (patch: Row) => {
      pendingUpdate = patch;
      return builder;
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };
  return builder;
}

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: { id: "me", company_id: "co", role: "team_member" } }),
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => query(table),
    rpc: async (fn: string, args: Row) => {
      state.rpcCalls.push({ fn, args });
      return { data: null, error: null };
    },
  }),
}));
vi.mock("./usage", () => ({ logCoachTokenUsage: async () => {} }));
vi.mock("@/lib/observability/report", () => ({ reportError: () => {} }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        state.modelCalls += 1;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                memories: [
                  { kind: "said", content: "Wants to hold a weekly one-to-one with each direct report." },
                ],
              }),
            },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        };
      },
    };
  },
}));

function conversation(id: string, origin: "page" | "panel"): Row {
  return {
    id,
    created_by: "me",
    mode: "general",
    practice_id: null,
    subject_profile_id: null,
    origin,
    updated_at: "2026-09-28T10:00:00Z",
    memory_summarized_through: null,
  };
}

function messages(conversationId: string): Row[] {
  return [1, 2, 3].flatMap((n) => [
    { conversation_id: conversationId, role: "user", content: `question ${n}`, created_at: `2026-09-28T09:0${n}:00Z` },
    { conversation_id: conversationId, role: "assistant", content: `answer ${n}`, created_at: `2026-09-28T09:0${n}:30Z` },
  ]);
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  state.rpcCalls = [];
  state.modelCalls = 0;
  state.tables = {
    coaching_conversations: [conversation("from-panel", "panel"), conversation("from-page", "page")],
    coaching_messages: [...messages("from-panel"), ...messages("from-page")],
  };
});

describe("coach memory and Aimee's panel", () => {
  it("writes memory for a page conversation and leaves it unchanged for a panel one", async () => {
    const { summarizeFinishedConversationsAction } = await import("./memory-actions");
    const result = await summarizeFinishedConversationsAction(null);

    const writes = state.rpcCalls.filter((c) => c.fn === "record_coach_memory");
    // The page conversation is written: the memory path works.
    expect(writes.map((w) => w.args.p_conversation_ref)).toContain("from-page");
    // The panel conversation is not: nothing written, and not even
    // read by the model.
    expect(writes.map((w) => w.args.p_conversation_ref)).not.toContain("from-panel");
    expect(state.modelCalls).toBe(1);
    expect(result).toMatchObject({ ok: true, conversationsSummarized: 1, memoriesWritten: 1 });
    // Not watermarked either: it was never read.
    const panelRow = state.tables.coaching_conversations.find((r) => r.id === "from-panel");
    expect(panelRow?.memory_summarized_through).toBeNull();
  });

  it("still skips a panel conversation when it is later opened on the Aimee page", async () => {
    // The sweep excludes the conversation being opened; this one is
    // open elsewhere, so it is a candidate by that rule, and the
    // origin alone keeps it out.
    const { summarizeFinishedConversationsAction } = await import("./memory-actions");
    await summarizeFinishedConversationsAction("from-page");
    expect(state.rpcCalls.filter((c) => c.fn === "record_coach_memory")).toEqual([]);
    expect(state.modelCalls).toBe(0);
  });
});
