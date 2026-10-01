import { beforeEach, describe, expect, it, vi } from "vitest";

// OPENING ONE OF AIMEE'S NOTIFICATIONS IN THE PANEL (Step 5).
//
// The browser names the notification and nothing else. The nudge or
// conversation comes from the row, which RLS lets only its recipient
// read, so the client has nothing it could change into somebody else's.

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  notification: null as Row | null,
  opened: [] as string[],
  reads: [] as Row[],
  conversation: null as Row | null,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: { id: "me", role: "team_member", company_id: "co" } }),
}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      let patch: Row | null = null;
      const b = {
        select: () => b,
        eq: () => b,
        is: () => b,
        update: (p: Row) => ((patch = p), b),
        maybeSingle: async () => ({ data: table === "notifications" ? h.notification : null, error: null }),
        then: (res: (v: { error: null }) => unknown) => {
          if (patch) h.reads.push({ table, ...patch });
          return Promise.resolve({ error: null }).then(res);
        },
      };
      return b;
    },
  }),
}));
vi.mock("@/lib/guide/open-nudge", () => ({
  openNudge: async (id: string) => {
    h.opened.push(id);
    return { ok: true, conversationId: "debrief-conversation" };
  },
}));
vi.mock("@/lib/coach/service", () => ({
  getConversation: async (id: string) => (h.conversation ? { ...h.conversation, id } : null),
  getAccessForConversation: async () => "owner",
  getMessages: async () => [],
  getMessageSenders: async () => new Map(),
  listSharesForConversation: async () => [],
}));
vi.mock("@/lib/practices/resolve", () => ({ resolveAgent: async () => null }));
vi.mock("@/lib/subscriptions/service", () => ({ getCompanyFeatures: async () => [] }));
vi.mock("@/lib/admin/scope", () => ({ getEffectiveCompanyId: async () => "co" }));
vi.mock("@/lib/coach/create-general", () => ({ createGeneralConversation: async () => ({ ok: false, message: "x" }) }));
vi.mock("./panel", () => ({ recordPanelEvent: async () => {} }));

beforeEach(() => {
  h.notification = null;
  h.opened = [];
  h.reads = [];
  h.conversation = { mode: "general", company_id: "co", created_by: "me", practice_id: null, agent_version_id: null };
});

describe("openAimeeNotificationAction", () => {
  it("opens an invitation through openNudge, with the nudge id from the row", async () => {
    h.notification = { id: "notif", kind: "guide-nudge", href: "/guide/nudge/n1", payload: { nudge_id: "n1" } };
    const { openAimeeNotificationAction } = await import("./panel-actions");
    const r = await openAimeeNotificationAction("notif");
    expect(h.opened).toEqual(["n1"]);
    expect(r.ok && r.chat.conversation.id).toBe("debrief-conversation");
  });

  it("opens a shared chat and marks it read", async () => {
    h.notification = { id: "notif", kind: "chat_shared", href: "/ask-aimee/c1", payload: { conversation_id: "c1" } };
    const { openAimeeNotificationAction } = await import("./panel-actions");
    const r = await openAimeeNotificationAction("notif");
    expect(r.ok && r.chat.conversation.id).toBe("c1");
    expect(h.reads).toEqual([expect.objectContaining({ table: "notifications", read_at: expect.any(String) })]);
  });

  it("refuses a notification that is not the caller's (RLS returns no row), and opens nothing", async () => {
    const { openAimeeNotificationAction } = await import("./panel-actions");
    expect(await openAimeeNotificationAction("someone-elses")).toEqual({ ok: false, message: "That notification is gone." });
    expect(h.opened).toEqual([]);
  });

  it("does not open a bell notification in the panel", async () => {
    h.notification = { id: "notif", kind: "champion-empty", href: "/admin/companies", payload: {} };
    const { openAimeeNotificationAction } = await import("./panel-actions");
    expect((await openAimeeNotificationAction("notif")).ok).toBe(false);
  });

  it("sends a chat about a person to their coaching page", async () => {
    h.notification = { id: "notif", kind: "chat_shared", href: "/coach/p1/c1", payload: { conversation_id: "c1" } };
    h.conversation = { mode: "about", subject_profile_id: "p1", company_id: "co", created_by: "x" };
    const { openAimeeNotificationAction } = await import("./panel-actions");
    expect(await openAimeeNotificationAction("notif")).toMatchObject({ ok: false, href: "/coach/p1/c1" });
  });
});
