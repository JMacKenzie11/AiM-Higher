import { describe, it, expect, beforeEach, vi } from "vitest";

// Tests for setConversationAgentAction — the write path for the
// AgentPicker. Pins the invariants that matter:
//   - Owner-only. Sharees + strangers refused.
//   - Lock: refuses if ANY user-role message exists.
//   - Swap HIDES prior assistant openers (hide_conversation_openers,
//     migration 0239) so a leader who tries three agents in a row
//     doesn't end up with three greetings. Never deletes: the fake
//     client below has no delete(), so a delete fails the test. It used
//     to have one that pretended to work, which is how a delete the
//     real database refused went unnoticed.
//   - null agentId clears back to plain Ask Aimee.
//   - Scripted opener persists inline; generate mode signals the
//     client to fire /api/coach separately (runGenerateOpener=true).
//
// Registry is imported for real — the tests reference practice ids
// from PRACTICES so the fixture stays in sync with what ships.

type ConvoRow = {
  id: string;
  company_id: string;
  created_by: string;
  mode: "about" | "general";
  practice_id: string | null;
  subject_profile_id: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  created_by: string;
  role: "user" | "assistant";
  content: string;
  hidden_at?: string | null;
};

const db = {
  coaching_conversations: [] as ConvoRow[],
  coaching_messages: [] as MessageRow[],
  nextMsgId: 1,
};

function reset() {
  db.coaching_conversations = [];
  db.coaching_messages = [];
  db.nextMsgId = 1;
}

function fromBuilder(table: keyof typeof db) {
  const filters: Array<{ col: string; val: unknown }> = [];
  const applyFilters = <T extends Record<string, unknown>>(rows: T[]): T[] =>
    rows.filter((r) =>
      filters.every((f) => (r as Record<string, unknown>)[f.col] === f.val)
    );

  return {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      const chain = {
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return chain;
        },
        order() {
          return chain;
        },
        maybeSingle: async () => {
          const rows = applyFilters(
            db[table] as unknown as Array<Record<string, unknown>>
          );
          return { data: rows[0] ?? null, error: null };
        },
        then(resolve: (v: { data: unknown; count?: number; error: null }) => unknown) {
          const rows = applyFilters(
            db[table] as unknown as Array<Record<string, unknown>>
          );
          if (opts?.count === "exact") {
            resolve({
              data: opts.head ? null : rows,
              count: rows.length,
              error: null,
            });
          } else {
            resolve({ data: rows, error: null });
          }
        },
      };
      return chain;
    },
    insert(patch: Record<string, unknown>) {
      const arr = db[table] as unknown as Array<Record<string, unknown>>;
      const withId = {
        id: `msg_${db.nextMsgId++}`,
        ...patch,
        created_at: new Date().toISOString(),
      };
      arr.push(withId);
      return {
        select: () => ({
          single: async () => ({ data: withId, error: null }),
        }),
        async then(resolve: (v: { error: null }) => unknown) {
          resolve({ error: null });
        },
      };
    },
    update(patch: Record<string, unknown>) {
      const updateApi = {
        _f: [] as Array<{ col: string; val: unknown }>,
        eq(col: string, val: unknown) {
          this._f.push({ col, val });
          return this;
        },
        async then(resolve: (v: { error: null }) => unknown) {
          const rows = db[table] as unknown as Array<Record<string, unknown>>;
          for (const r of rows) {
            if (updateApi._f.every((f) => r[f.col] === f.val)) {
              Object.assign(r, patch);
            }
          }
          resolve({ error: null });
        },
      };
      return updateApi;
    },
  };
}

const requireProfileMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: fromBuilder,
    // hide_conversation_openers, as the migration defines it for the
    // owner before the first user turn (the action has already checked
    // both): every visible assistant row gets hidden_at.
    rpc: async (name: string, args: { p_conversation_id: string }) => {
      if (name !== "hide_conversation_openers") throw new Error(`unexpected rpc ${name}`);
      let n = 0;
      for (const m of db.coaching_messages as Array<Record<string, unknown>>) {
        if (m.conversation_id === args.p_conversation_id && m.role === "assistant" && !m.hidden_at) {
          m.hidden_at = new Date().toISOString();
          n++;
        }
      }
      return { data: n, error: null };
    },
  }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: requireProfileMock,
}));

vi.mock("@/lib/admin/scope", () => ({
  getEffectiveCompanyId: vi.fn(async () => "co_acme"),
}));

vi.mock("@/lib/subscriptions/service", () => ({
  companyHasFeature: vi.fn(async () => true),
}));

vi.mock("@/lib/analytics/track", () => ({
  trackAfter: vi.fn(),
}));

vi.mock("@/lib/notifications/service", () => ({
  insertNotification: vi.fn(async () => ({ ok: true, id: "n_1" })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/coach/title", () => ({
  cleanGeneratedTitle: (s: string) => s,
}));

vi.mock("@/lib/coach/usage", () => ({
  logCoachTokenUsage: vi.fn(),
}));

function sessionFor(id: string, role: "team_member" | "company_admin" = "company_admin") {
  return {
    profile: {
      id,
      role,
      company_id: "co_acme",
    },
  };
}

function seedGeneralConvo(overrides: Partial<ConvoRow> = {}) {
  db.coaching_conversations.push({
    id: "conv_1",
    company_id: "co_acme",
    created_by: "owner_1",
    mode: "general",
    practice_id: null,
    subject_profile_id: null,
    ...overrides,
  });
}

describe("setConversationAgentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it("owner can attach an agent to a fresh conversation", async () => {
    seedGeneralConvo();
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));

    const { setConversationAgentAction } = await import("./actions");
    const res = await setConversationAgentAction(
      "conv_1",
      "functional-chart-builder"
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.runGenerateOpener).toBe(false);
      // Current registry ships every agent with the chip pattern
      // — no scriptedOpener, no firstTurn. Nothing gets persisted
      // on attach; the user's chip click becomes turn one.
      expect(res.openerContent).toBe(null);
      expect(res.practiceId).toBe("functional-chart-builder");
    }
    expect(db.coaching_conversations[0].practice_id).toBe(
      "functional-chart-builder"
    );
    expect(db.coaching_messages).toHaveLength(0);
  });

  it("swapping agent before first user message hides the prior opener, and deletes nothing", async () => {
    seedGeneralConvo({ practice_id: "functional-chart-builder" });
    db.coaching_messages.push({
      id: "msg_prev",
      conversation_id: "conv_1",
      created_by: "owner_1",
      role: "assistant",
      content: "Prior opener from another agent.",
    });
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));

    const { setConversationAgentAction } = await import("./actions");
    const res = await setConversationAgentAction("conv_1", null);
    expect(res.ok).toBe(true);
    expect(db.coaching_conversations[0].practice_id).toBe(null);
    // Clear-to-Aimee hides the prior opener and inserts none. The row
    // is still there: hidden, not deleted.
    expect(db.coaching_messages).toHaveLength(1);
    expect(db.coaching_messages[0].hidden_at).toBeTruthy();
  });

  it("refuses to change agent after any user turn (lock)", async () => {
    seedGeneralConvo({ practice_id: "prepare-a-hard-conversation" });
    db.coaching_messages.push({
      id: "msg_u",
      conversation_id: "conv_1",
      created_by: "owner_1",
      role: "user",
      content: "I already said something.",
    });
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));

    const { setConversationAgentAction } = await import("./actions");
    const res = await setConversationAgentAction(
      "conv_1",
      "functional-chart-builder"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/already underway/);
    // Slot unchanged.
    expect(db.coaching_conversations[0].practice_id).toBe(
      "prepare-a-hard-conversation"
    );
  });

  it("blocks a non-owner", async () => {
    seedGeneralConvo();
    requireProfileMock.mockResolvedValue(sessionFor("intruder"));

    const { setConversationAgentAction } = await import("./actions");
    const res = await setConversationAgentAction(
      "conv_1",
      "functional-chart-builder"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Only the owner/);
  });

  it("refuses an unknown agent id", async () => {
    seedGeneralConvo();
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));

    const { setConversationAgentAction } = await import("./actions");
    const res = await setConversationAgentAction("conv_1", "no-such-agent");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/isn't available/);
  });

  it("refuses when the caller's role isn't in the practice's allowedRoles", async () => {
    seedGeneralConvo();
    // Functional Chart Builder is admin-only; a team_member should
    // be rejected by practiceRoleGate even though they own the thread.
    requireProfileMock.mockResolvedValue(sessionFor("owner_1", "team_member"));

    const { setConversationAgentAction } = await import("./actions");
    const res = await setConversationAgentAction(
      "conv_1",
      "functional-chart-builder"
    );
    expect(res.ok).toBe(false);
  });

  it("refuses to attach an agent to an about-mode thread", async () => {
    // Coach threads (mode='about') are person-scoped and don't
    // carry an agent slot in the UI. The picker never renders
    // there, but the action should refuse defensively so a
    // hand-crafted call can't smuggle a practice_id into an
    // 'about' row.
    seedGeneralConvo({
      mode: "about",
      subject_profile_id: "subject_1",
    });
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));

    const { setConversationAgentAction } = await import("./actions");
    const res = await setConversationAgentAction(
      "conv_1",
      "functional-chart-builder"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/general conversations/);
    expect(db.coaching_conversations[0].practice_id).toBe(null);
  });

  it("null agentId clears back to plain Aimee", async () => {
    seedGeneralConvo({ practice_id: "functional-chart-builder" });
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));

    const { setConversationAgentAction } = await import("./actions");
    const res = await setConversationAgentAction("conv_1", null);
    expect(res.ok).toBe(true);
    expect(db.coaching_conversations[0].practice_id).toBe(null);
  });
});
