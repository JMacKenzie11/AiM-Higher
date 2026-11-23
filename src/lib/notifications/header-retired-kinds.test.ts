import { beforeEach, describe, expect, it, vi } from "vitest";

// RETIRED KINDS ARE NEVER SHOWN (0329; Jason, 2026-11-23). The weekly
// debrief invitation is off and the champion seat is gone, so an
// invitation or "the seat is empty" notice already sent leads nowhere.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from() {
      const b = {
        select: () => b,
        eq: () => b,
        is: () => b,
        not: () => b,
        order: () => b,
        limit: async () => ({ data: h.rows, error: null }),
      };
      return b;
    },
  }),
}));

const row = (id: string, kind: string) => ({
  id,
  kind,
  eyebrow: null,
  title: id,
  href: "/",
  created_at: "2026-11-23T10:00:00Z",
});

beforeEach(() => {
  h.rows = [
    row("invite", "guide-nudge"),
    row("empty", "champion-empty"),
    row("shared", "chat_shared"),
    row("access", "coaching-access"),
  ];
});

describe("header notifications and retired kinds", () => {
  it("leaves out debrief invitations and empty-seat notices, and keeps everything else", async () => {
    const { getHeaderNotifications } = await import("./service");
    const items = await getHeaderNotifications({ userId: "me", companyId: "co", timezone: "UTC", features: [] });
    expect(items.map((i) => i.id)).toEqual(["shared", "access"]);
  });
});
