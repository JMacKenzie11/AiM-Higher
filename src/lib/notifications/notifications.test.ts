import { describe, it, expect, beforeEach, vi } from "vitest";

// Tests for the event-based notifications layer.
// Pins the invariants that matter:
//   - insertNotification uses the admin client (bypasses RLS) so
//     any server-code path can create for any recipient without
//     the caller needing insert grants on notifications
//   - self-notifications short-circuit before the insert (a "you
//     shared with yourself" ping would just be noise)
//   - markNotificationReadAction only touches the caller's own
//     unread rows and sets read_at (idempotent — already-read
//     rows are a no-op via the .is('read_at', null) filter)
//
// The Supabase mocks track inserts and updates as plain arrays.
// Tests reach into them directly to assert side-effects.

// ---- In-memory notifications table --------------------------
type NotificationRow = {
  id: string;
  recipient_id: string;
  company_id: string;
  kind: string;
  title: string;
  href: string;
  eyebrow: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_by: string | null;
  created_at: string;
};

const db = {
  notifications: [] as NotificationRow[],
  nextId: 1,
};

function reset() {
  db.notifications = [];
  db.nextId = 1;
}

// Admin client — used by insertNotification. Simulates the
// insert() → select() → single() chain.
function adminFromBuilder(_table: string) {
  return {
    insert(patch: Record<string, unknown>) {
      const id = `notif_${db.nextId++}`;
      const row: NotificationRow = {
        id,
        recipient_id: patch.recipient_id as string,
        company_id: patch.company_id as string,
        kind: patch.kind as string,
        title: patch.title as string,
        href: patch.href as string,
        eyebrow: (patch.eyebrow as string | null) ?? null,
        payload: (patch.payload as Record<string, unknown>) ?? {},
        read_at: null,
        created_by: (patch.created_by as string | null) ?? null,
        created_at: new Date().toISOString(),
      };
      db.notifications.push(row);
      return {
        select: () => ({
          single: async () => ({ data: { id }, error: null }),
        }),
      };
    },
  };
}

// Server (auth-scoped) client — used by markNotificationReadAction.
// Supports .update({read_at}).eq().eq().is() chain.
function serverFromBuilder(_table: string) {
  return {
    update(patch: Record<string, unknown>) {
      const updateApi = {
        _f: [] as Array<{ col: string; val: unknown; is?: boolean }>,
        eq(col: string, val: unknown) {
          this._f.push({ col, val });
          return this;
        },
        is(col: string, val: unknown) {
          this._f.push({ col, val, is: true });
          return this;
        },
        async then(resolve: (v: { error: null }) => unknown) {
          for (const row of db.notifications) {
            const matches = updateApi._f.every((f) => {
              const cell = (row as Record<string, unknown>)[f.col];
              return cell === f.val;
            });
            if (matches) Object.assign(row, patch);
          }
          resolve({ error: null });
        },
      };
      return updateApi;
    },
  };
}

const requireProfileMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: adminFromBuilder }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: serverFromBuilder }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: requireProfileMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// ============================================================
// insertNotification
// ============================================================
describe("insertNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it("writes a row via the admin client and returns the id", async () => {
    const { insertNotification } = await import("./service");
    const res = await insertNotification({
      recipientId: "sharee_1",
      companyId: "co_acme",
      kind: "chat_shared",
      title: "Owner shared a chat with you",
      href: "/ask-aimee/conv_1",
      createdBy: "owner_1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.id).toMatch(/^notif_/);
    expect(db.notifications).toHaveLength(1);
    expect(db.notifications[0]).toMatchObject({
      recipient_id: "sharee_1",
      company_id: "co_acme",
      kind: "chat_shared",
      title: "Owner shared a chat with you",
      href: "/ask-aimee/conv_1",
      created_by: "owner_1",
      read_at: null,
    });
  });

  it("silently skips a self-notification", async () => {
    const { insertNotification } = await import("./service");
    const res = await insertNotification({
      recipientId: "me",
      companyId: "co_acme",
      kind: "chat_shared",
      title: "You shared something with yourself",
      href: "/ask-aimee/conv_1",
      createdBy: "me",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/skipped self-notification/);
    expect(db.notifications).toHaveLength(0);
  });

  it("defaults eyebrow to null and payload to empty when omitted", async () => {
    const { insertNotification } = await import("./service");
    await insertNotification({
      recipientId: "sharee_1",
      companyId: "co_acme",
      kind: "chat_shared",
      title: "Bare",
      href: "/ask-aimee/conv_1",
      createdBy: "owner_1",
    });
    expect(db.notifications[0].eyebrow).toBe(null);
    expect(db.notifications[0].payload).toEqual({});
  });
});

// ============================================================
// markNotificationReadAction
// ============================================================
describe("markNotificationReadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it("sets read_at on the caller's own unread row", async () => {
    db.notifications.push({
      id: "notif_a",
      recipient_id: "me",
      company_id: "co_acme",
      kind: "chat_shared",
      title: "x",
      href: "/",
      eyebrow: null,
      payload: {},
      read_at: null,
      created_by: "other",
      created_at: "t",
    });
    requireProfileMock.mockResolvedValue({
      profile: { id: "me", role: "team_member", company_id: "co_acme" },
    });

    const { markNotificationReadAction } = await import("./actions");
    const res = await markNotificationReadAction("notif_a");
    expect(res.ok).toBe(true);
    expect(db.notifications[0].read_at).not.toBe(null);
  });

  it("does not touch someone else's row", async () => {
    db.notifications.push({
      id: "notif_a",
      recipient_id: "other",
      company_id: "co_acme",
      kind: "chat_shared",
      title: "x",
      href: "/",
      eyebrow: null,
      payload: {},
      read_at: null,
      created_by: "sender",
      created_at: "t",
    });
    requireProfileMock.mockResolvedValue({
      profile: { id: "me", role: "team_member", company_id: "co_acme" },
    });

    const { markNotificationReadAction } = await import("./actions");
    const res = await markNotificationReadAction("notif_a");
    expect(res.ok).toBe(true); // Action succeeds vacuously
    expect(db.notifications[0].read_at).toBe(null); // Row untouched
  });

  it("is idempotent — already-read rows stay at their original read_at", async () => {
    const originalReadAt = "2026-01-01T00:00:00.000Z";
    db.notifications.push({
      id: "notif_a",
      recipient_id: "me",
      company_id: "co_acme",
      kind: "chat_shared",
      title: "x",
      href: "/",
      eyebrow: null,
      payload: {},
      read_at: originalReadAt,
      created_by: "other",
      created_at: "t",
    });
    requireProfileMock.mockResolvedValue({
      profile: { id: "me", role: "team_member", company_id: "co_acme" },
    });

    const { markNotificationReadAction } = await import("./actions");
    await markNotificationReadAction("notif_a");
    expect(db.notifications[0].read_at).toBe(originalReadAt);
  });
});
