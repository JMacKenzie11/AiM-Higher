import { beforeEach, describe, expect, it, vi } from "vitest";

// THE SWEEP CLAIMS A CONVERSATION BEFORE IT READS IT, AND HANDS IT
// BACK WHEN NOTHING USABLE CAME OF THE READ (2026-11-14).
//
// Before: two sweeps (the list page then the conversation page, or two
// tabs) read the same watermark, both summarised, every memory written
// twice. And a call that failed, was cut off, or came back illegible
// still moved the watermark past those messages, so they were never
// read again. Run through the real sweep with the database and the
// model faked; the fake applies an update only to the rows every
// filter leaves, as Postgres does.

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as Row[],
  reply: async (): Promise<unknown> => ({ content: [], usage: {} }),
  calls: 0,
}));

function query(table: string) {
  let rows = [...(state.tables[table] ?? [])];
  let patch: Row | null = null;
  const b = {
    select: () => b,
    order: () => b,
    limit: (n: number) => ((rows = rows.slice(0, n)), b),
    eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b),
    neq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] !== v)), b),
    is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b),
    in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), b),
    gt: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) > v)), b),
    update: (p: Row) => ((patch = p), b),
    // Copies out, as a database returns them: a row read earlier does
    // not change under the reader when someone else updates it.
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      if (patch) for (const r of rows) Object.assign(r, patch);
      return resolve({ data: rows.map((r) => ({ ...r })), error: null });
    },
  };
  return b;
}

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: { id: "me", company_id: "co", role: "team_member" } }),
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (t: string) => query(t),
    rpc: async (_fn: string, args: Row) => (state.writes.push(args), { data: "m", error: null }),
  }),
}));
vi.mock("./usage", () => ({ logCoachTokenUsage: async () => {} }));
vi.mock("@/lib/observability/report", () => ({ reportError: () => {} }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        state.calls += 1;
        return state.reply();
      },
    };
  },
}));

const LEGIBLE = {
  content: [{ type: "text", text: JSON.stringify({ memories: [{ kind: "said", content: "Plans to hand the Thursday run to Marcus." }] }) }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};
const watermark = () => state.tables.coaching_conversations[0].memory_summarized_through;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  state.writes = [];
  state.calls = 0;
  state.reply = async () => LEGIBLE;
  state.tables = {
    coaching_conversations: [
      { id: "c1", created_by: "me", mode: "general", practice_id: null, subject_profile_id: null, origin: "page", updated_at: "2026-11-14T10:00:00Z", memory_summarized_through: null },
    ],
    coaching_messages: [
      { conversation_id: "c1", role: "user", content: "I keep putting off the Thursday handover.", created_at: "2026-11-14T09:01:00Z" },
      { conversation_id: "c1", role: "assistant", content: "What is holding it?", created_at: "2026-11-14T09:01:30Z" },
      { conversation_id: "c1", role: "user", content: "Partly I hate the conversation.", created_at: "2026-11-14T09:02:00Z" },
      { conversation_id: "c1", role: "assistant", content: "What would make it easier?", created_at: "2026-11-14T09:02:30Z" },
    ],
  };
});

async function sweep() {
  const { summarizeFinishedConversationsAction } = await import("./memory-actions");
  return summarizeFinishedConversationsAction(null);
}

describe("the memory sweep", () => {
  it("summarises a conversation once when two sweeps start together", async () => {
    await Promise.all([sweep(), sweep()]);
    expect(state.calls).toBe(1);
    expect(state.writes).toHaveLength(1);
    expect(watermark()).toBe("2026-11-14T09:02:30Z");
  });

  it("marks a conversation read when the model kept nothing", async () => {
    state.reply = async () => ({ ...LEGIBLE, content: [{ type: "text", text: '{"memories": []}' }] });
    await sweep();
    expect(state.writes).toHaveLength(0);
    expect(watermark()).toBe("2026-11-14T09:02:30Z");
  });

  it("hands the conversation back when the call fails, so the next visit reads it", async () => {
    state.reply = async () => {
      throw new Error("overloaded");
    };
    await sweep();
    expect(watermark()).toBeNull();
    state.reply = async () => LEGIBLE;
    await sweep();
    expect(state.writes).toHaveLength(1);
  });

  it("hands it back when the answer cannot be read", async () => {
    state.reply = async () => ({ ...LEGIBLE, content: [{ type: "text", text: "Here are the memories I would keep: the handover." }] });
    await sweep();
    expect(state.writes).toHaveLength(0);
    expect(watermark()).toBeNull();
  });

  it("hands it back when the answer was cut off", async () => {
    state.reply = async () => ({ ...LEGIBLE, stop_reason: "max_tokens", content: [] });
    await sweep();
    expect(watermark()).toBeNull();
  });
});
