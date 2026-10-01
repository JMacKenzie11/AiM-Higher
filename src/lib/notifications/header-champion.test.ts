import { beforeEach, describe, expect, it, vi } from "vitest";

// AN INVITATION SHOWS ONLY TO WHOEVER HOLDS THE CHAMPION SEAT NOW
// (2026-09-29). Moving the seat does nothing to invitations already
// sent, so without this the previous champion kept one, with a badge,
// that could not be opened.

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ champion: true, rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/guide/champion", () => ({ isAimsChampion: async () => h.champion }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from() {
      const b = {
        select: () => b,
        eq: () => b,
        is: () => b,
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
  created_at: "2026-09-29T10:00:00Z",
});

beforeEach(() => {
  h.champion = true;
  h.rows = [row("invite", "guide-nudge"), row("shared", "chat_shared")];
});

describe("header notifications and the champion seat", () => {
  it("shows the champion their invitation", async () => {
    const { getHeaderNotifications } = await import("./service");
    const items = await getHeaderNotifications({ userId: "me", companyId: "co", timezone: "UTC", features: [] });
    expect(items.map((i) => i.id)).toEqual(["invite", "shared"]);
  });

  it("hides an invitation from someone no longer in the seat, and keeps everything else", async () => {
    h.champion = false;
    const { getHeaderNotifications } = await import("./service");
    const items = await getHeaderNotifications({ userId: "me", companyId: "co", timezone: "UTC", features: [] });
    expect(items.map((i) => i.id)).toEqual(["shared"]);
  });
});
