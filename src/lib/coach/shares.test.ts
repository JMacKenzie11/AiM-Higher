import { describe, it, expect, beforeEach, vi } from "vitest";

// Tests for the coaching-conversation sharing layer. Pins the
// invariants that matter most:
//   - the cross-tenant rule (a friendly denial fires before the DB
//     trigger raises)
//   - only the owner can share / update access / remove people
//   - sharees can leave; non-sharees can't
//   - getAccessForConversation returns owner | write | read | null
//     for the four states the /api/coach route + UI branch on
//
// The mock is intentionally small: it tracks per-table state as
// plain arrays and returns fresh chainable builders on every
// .from() call. Tests reach into these arrays directly to seed
// scenarios and to assert side-effects.

// ---- In-memory tables + chainable builder --------------------
type ConvoRow = {
  id: string;
  company_id: string;
  created_by: string;
  mode: "about" | "general";
  subject_profile_id: string | null;
};

type ProfileRow = {
  id: string;
  company_id: string | null;
  status: "pending" | "active" | "inactive";
  role: "system_admin" | "company_admin" | "team_member" | "aims_guide";
  full_name: string;
  avatar_url: string | null;
  position: string | null;
};

type ShareRow = {
  conversation_id: string;
  profile_id: string;
  access: "read" | "write";
  created_by: string;
  created_at: string;
};

type GuideAssignmentRow = {
  guide_id: string;
  company_id: string;
};

const db = {
  coaching_conversations: [] as ConvoRow[],
  profiles: [] as ProfileRow[],
  coaching_conversation_shares: [] as ShareRow[],
  guide_assignments: [] as GuideAssignmentRow[],
  insertError: null as null | { message: string },
};

function reset() {
  db.coaching_conversations = [];
  db.profiles = [];
  db.coaching_conversation_shares = [];
  db.guide_assignments = [];
  db.insertError = null;
}

// Minimal chainable builder that supports the shapes each share
// action uses. Enough to exercise the code paths without pulling
// in real Supabase.
function fromBuilder(table: keyof typeof db) {
  const filters: Array<{ col: string; val: unknown }> = [];
  const applyFilters = <T extends Record<string, unknown>>(rows: T[]): T[] =>
    rows.filter((r) => filters.every((f) => (r as Record<string, unknown>)[f.col] === f.val));

  const selectApi = {
    eq(col: string, val: unknown) {
      filters.push({ col, val });
      return selectApi;
    },
    order() {
      return selectApi;
    },
    maybeSingle: async () => {
      const rows = applyFilters(
        (db[table] as unknown as Array<Record<string, unknown>>)
      );
      return { data: rows[0] ?? null, error: null };
    },
    // Some paths iterate the array with a Promise resolution instead
    // of maybeSingle — we alias to keep parity with tests that select
    // multiple rows.
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      const rows = applyFilters(
        (db[table] as unknown as Array<Record<string, unknown>>)
      );
      resolve({ data: rows, error: null });
    },
  };

  return {
    select() {
      return selectApi;
    },
    insert(patch: Record<string, unknown>) {
      if (db.insertError) {
        return {
          select: () => ({
            single: async () => ({ data: null, error: db.insertError }),
          }),
          async then(resolve: (v: { error: unknown }) => unknown) {
            resolve({ error: db.insertError });
          },
        };
      }
      const arr = db[table] as unknown as Array<Record<string, unknown>>;
      arr.push({ ...patch, created_at: new Date().toISOString() });
      return {
        select: () => ({
          single: async () => ({
            data: { ...patch, created_at: new Date().toISOString() },
            error: null,
          }),
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
    delete() {
      const deleteApi = {
        _f: [] as Array<{ col: string; val: unknown }>,
        eq(col: string, val: unknown) {
          this._f.push({ col, val });
          return this;
        },
        async then(resolve: (v: { error: null }) => unknown) {
          const rows = db[table] as unknown as Array<Record<string, unknown>>;
          for (let i = rows.length - 1; i >= 0; i--) {
            if (deleteApi._f.every((f) => rows[i][f.col] === f.val)) {
              rows.splice(i, 1);
            }
          }
          resolve({ error: null });
        },
      };
      return deleteApi;
    },
  };
}

// ---- Module mocks -------------------------------------------
const requireProfileMock = vi.fn();
const getEffectiveCompanyIdMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: fromBuilder }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: requireProfileMock,
}));

vi.mock("@/lib/admin/scope", () => ({
  getEffectiveCompanyId: getEffectiveCompanyIdMock,
}));

vi.mock("@/lib/subscriptions/service", () => ({
  companyHasFeature: vi.fn(async () => true),
}));

vi.mock("@/lib/analytics/track", () => ({
  trackAfter: vi.fn(),
}));

// Notification insert is fire-and-forget from shareConversationAction.
// Stub it so tests don't try to spin up the admin Supabase client
// (which requires real env). We also spy on it so the share tests
// can assert the notification fired exactly when it should.
const insertNotificationMock = vi.fn(async () => ({ ok: true, id: "notif_1" }));
vi.mock("@/lib/notifications/service", () => ({
  insertNotification: insertNotificationMock,
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

function sessionFor(id: string) {
  return {
    profile: {
      id,
      role: "team_member" as const,
      company_id: "co_acme",
    },
  };
}

// ============================================================
// shareConversationAction
// ============================================================
describe("shareConversationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
    getEffectiveCompanyIdMock.mockResolvedValue("co_acme");
    db.coaching_conversations.push({
      id: "conv_1",
      company_id: "co_acme",
      created_by: "owner_1",
      mode: "general",
      subject_profile_id: null,
    });
  });

  it("blocks a non-owner from sharing", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("intruder"));
    db.profiles.push({
      id: "sharee_1",
      company_id: "co_acme",
      status: "active",
      role: "team_member",
      full_name: "Sharee One",
      avatar_url: null,
      position: null,
    });

    const { shareConversationAction } = await import("./actions");
    const res = await shareConversationAction("conv_1", "sharee_1", "write");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Only the owner/);
    expect(db.coaching_conversation_shares).toHaveLength(0);
  });

  it("refuses to share across tenants (friendly denial)", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    db.profiles.push({
      id: "sharee_other",
      company_id: "co_other",
      status: "active",
      role: "team_member",
      full_name: "Outsider",
      avatar_url: null,
      position: null,
    });

    const { shareConversationAction } = await import("./actions");
    const res = await shareConversationAction(
      "conv_1",
      "sharee_other",
      "write"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/same company/);
    expect(db.coaching_conversation_shares).toHaveLength(0);
  });

  it("refuses to share with an inactive profile", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    db.profiles.push({
      id: "sharee_inactive",
      company_id: "co_acme",
      status: "inactive",
      role: "team_member",
      full_name: "Left Building",
      avatar_url: null,
      position: null,
    });

    const { shareConversationAction } = await import("./actions");
    const res = await shareConversationAction(
      "conv_1",
      "sharee_inactive",
      "write"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/isn't active/);
  });

  it("owner successfully shares with a same-company active profile", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    db.profiles.push({
      id: "sharee_1",
      company_id: "co_acme",
      status: "active",
      role: "team_member",
      full_name: "Sharee One",
      avatar_url: null,
      position: null,
    });

    const { shareConversationAction } = await import("./actions");
    const res = await shareConversationAction("conv_1", "sharee_1", "write");
    expect(res.ok).toBe(true);
    expect(db.coaching_conversation_shares).toHaveLength(1);
    expect(db.coaching_conversation_shares[0]).toMatchObject({
      conversation_id: "conv_1",
      profile_id: "sharee_1",
      access: "write",
      created_by: "owner_1",
    });
  });

  it("rejects an invalid access value", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    const { shareConversationAction } = await import("./actions");
    const res = await shareConversationAction(
      "conv_1",
      "sharee_1",
      "admin" as unknown as "read"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/read or write/);
  });

  it("allows sharing with an assigned aims_guide even though guide.company_id is null", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    db.profiles.push({
      id: "guide_1",
      company_id: null,
      status: "active",
      role: "aims_guide",
      full_name: "Assigned Guide",
      avatar_url: null,
      position: "AiMS Guide",
    });
    db.guide_assignments.push({ guide_id: "guide_1", company_id: "co_acme" });

    const { shareConversationAction } = await import("./actions");
    const res = await shareConversationAction("conv_1", "guide_1", "write");
    expect(res.ok).toBe(true);
    expect(db.coaching_conversation_shares).toHaveLength(1);
    expect(db.coaching_conversation_shares[0]).toMatchObject({
      conversation_id: "conv_1",
      profile_id: "guide_1",
      access: "write",
    });
  });

  it("refuses to share with an unassigned aims_guide", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    db.profiles.push({
      id: "guide_stray",
      company_id: null,
      status: "active",
      role: "aims_guide",
      full_name: "Unrelated Guide",
      avatar_url: null,
      position: "AiMS Guide",
    });
    // No guide_assignments row for co_acme.

    const { shareConversationAction } = await import("./actions");
    const res = await shareConversationAction("conv_1", "guide_stray", "write");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/same company/);
    expect(db.coaching_conversation_shares).toHaveLength(0);
  });

  it("fires exactly one chat_shared notification on the happy path", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    db.profiles.push({
      id: "sharee_1",
      company_id: "co_acme",
      status: "active",
      role: "team_member",
      full_name: "Sharee One",
      avatar_url: null,
      position: null,
    });

    const { shareConversationAction } = await import("./actions");
    const res = await shareConversationAction("conv_1", "sharee_1", "write");
    expect(res.ok).toBe(true);
    // Give the void-fired notification a microtask tick to land.
    await Promise.resolve();
    expect(insertNotificationMock).toHaveBeenCalledTimes(1);
    expect(insertNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "sharee_1",
        companyId: "co_acme",
        kind: "chat_shared",
        createdBy: "owner_1",
      })
    );
  });

  it("does not fire a notification when the share is denied", async () => {
    // Cross-tenant sharee — the friendly path returns before insert.
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    db.profiles.push({
      id: "sharee_other",
      company_id: "co_other",
      status: "active",
      role: "team_member",
      full_name: "Outsider",
      avatar_url: null,
      position: null,
    });

    const { shareConversationAction } = await import("./actions");
    await shareConversationAction("conv_1", "sharee_other", "write");
    await Promise.resolve();
    expect(insertNotificationMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// leaveSharedConversationAction
// ============================================================
describe("leaveSharedConversationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
    getEffectiveCompanyIdMock.mockResolvedValue("co_acme");
    db.coaching_conversations.push({
      id: "conv_1",
      company_id: "co_acme",
      created_by: "owner_1",
      mode: "general",
      subject_profile_id: null,
    });
  });

  it("removes only the caller's own share row", async () => {
    db.coaching_conversation_shares.push(
      {
        conversation_id: "conv_1",
        profile_id: "sharee_a",
        access: "write",
        created_by: "owner_1",
        created_at: "t",
      },
      {
        conversation_id: "conv_1",
        profile_id: "sharee_b",
        access: "read",
        created_by: "owner_1",
        created_at: "t",
      }
    );
    requireProfileMock.mockResolvedValue(sessionFor("sharee_a"));

    const { leaveSharedConversationAction } = await import("./actions");
    const res = await leaveSharedConversationAction("conv_1");
    expect(res.ok).toBe(true);
    expect(db.coaching_conversation_shares).toHaveLength(1);
    expect(db.coaching_conversation_shares[0].profile_id).toBe("sharee_b");
  });

  it("refuses when the caller has no share on this thread", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("random"));
    const { leaveSharedConversationAction } = await import("./actions");
    const res = await leaveSharedConversationAction("conv_1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/don't have access/);
  });
});

// ============================================================
// unshareConversationAction + updateShareAccessAction
// ============================================================
describe("unshareConversationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
    getEffectiveCompanyIdMock.mockResolvedValue("co_acme");
    db.coaching_conversations.push({
      id: "conv_1",
      company_id: "co_acme",
      created_by: "owner_1",
      mode: "general",
      subject_profile_id: null,
    });
    db.coaching_conversation_shares.push({
      conversation_id: "conv_1",
      profile_id: "sharee_1",
      access: "write",
      created_by: "owner_1",
      created_at: "t",
    });
  });

  it("blocks a non-owner from removing someone", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("sharee_1"));
    const { unshareConversationAction } = await import("./actions");
    const res = await unshareConversationAction("conv_1", "sharee_1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Only the owner/);
    expect(db.coaching_conversation_shares).toHaveLength(1);
  });

  it("owner can remove a sharee", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    const { unshareConversationAction } = await import("./actions");
    const res = await unshareConversationAction("conv_1", "sharee_1");
    expect(res.ok).toBe(true);
    expect(db.coaching_conversation_shares).toHaveLength(0);
  });
});

describe("updateShareAccessAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
    getEffectiveCompanyIdMock.mockResolvedValue("co_acme");
    db.coaching_conversations.push({
      id: "conv_1",
      company_id: "co_acme",
      created_by: "owner_1",
      mode: "general",
      subject_profile_id: null,
    });
    db.coaching_conversation_shares.push({
      conversation_id: "conv_1",
      profile_id: "sharee_1",
      access: "write",
      created_by: "owner_1",
      created_at: "t",
    });
  });

  it("blocks a non-owner from changing access", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("random"));
    const { updateShareAccessAction } = await import("./actions");
    const res = await updateShareAccessAction("conv_1", "sharee_1", "read");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Only the owner/);
    expect(db.coaching_conversation_shares[0].access).toBe("write");
  });

  it("owner can downgrade write to read", async () => {
    requireProfileMock.mockResolvedValue(sessionFor("owner_1"));
    const { updateShareAccessAction } = await import("./actions");
    const res = await updateShareAccessAction("conv_1", "sharee_1", "read");
    expect(res.ok).toBe(true);
    expect(db.coaching_conversation_shares[0].access).toBe("read");
  });
});

// ============================================================
// getAccessForConversation
// ============================================================
describe("getAccessForConversation", () => {
  beforeEach(() => {
    reset();
    db.coaching_conversations.push({
      id: "conv_1",
      company_id: "co_acme",
      created_by: "owner_1",
      mode: "general",
      subject_profile_id: null,
    });
  });

  it("returns 'owner' for the creator", async () => {
    const { getAccessForConversation } = await import("./service");
    expect(await getAccessForConversation("conv_1", "owner_1")).toBe("owner");
  });

  it("returns the share access for a sharee", async () => {
    db.coaching_conversation_shares.push({
      conversation_id: "conv_1",
      profile_id: "sharee_1",
      access: "read",
      created_by: "owner_1",
      created_at: "t",
    });
    const { getAccessForConversation } = await import("./service");
    expect(await getAccessForConversation("conv_1", "sharee_1")).toBe("read");
  });

  it("returns null for a stranger", async () => {
    const { getAccessForConversation } = await import("./service");
    expect(await getAccessForConversation("conv_1", "stranger")).toBe(null);
  });

  it("returns null for a missing conversation", async () => {
    const { getAccessForConversation } = await import("./service");
    expect(await getAccessForConversation("nope", "owner_1")).toBe(null);
  });
});
