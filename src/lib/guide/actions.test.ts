import { describe, it, expect, beforeEach, vi } from "vitest";

// "Not now" moves TWO rows, and the second one is the point.
//
//   notifications  the champion stops seeing it. Housekeeping.
//   guide_nudges   the champion SAID no. That is a finding.
//
// Without the nudge write, a declined invitation and an ignored one
// are the same row in guide_nudge_weekly, and they mean opposite
// things about whether the Guide is worth keeping. So the test that
// matters here is not "the notification went away" — it is "the
// refusal was recorded".

type Call = { table: string; op: string; payload?: Record<string, unknown> };

const state = {
  calls: [] as Call[],
  notification: null as { id: string; payload: { nudge_id?: string } | null } | null,
};

const mocks = vi.hoisted(() => ({
  requireProfile: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/current-user", () => ({ requireProfile: mocks.requireProfile }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

function client() {
  return {
    from(table: string) {
      const chain = {
        select() {
          state.calls.push({ table, op: "select" });
          return chain;
        },
        update(payload: Record<string, unknown>) {
          state.calls.push({ table, op: "update", payload });
          return chain;
        },
        eq() {
          return chain;
        },
        is() {
          return Promise.resolve({ error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: state.notification });
        },
        then(resolve: (v: { error: null }) => unknown) {
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
}

const { dismissGuideNudgeAction } = await import("./actions");

beforeEach(() => {
  state.calls = [];
  state.notification = { id: "n1", payload: { nudge_id: "g1" } };
  mocks.requireProfile.mockResolvedValue({ profile: { id: "p1" } });
  mocks.createClient.mockResolvedValue(client());
  mocks.revalidatePath.mockReset();
});

describe("dismissGuideNudgeAction", () => {
  it("records the refusal on the nudge, not just on the notification", async () => {
    const result = await dismissGuideNudgeAction("n1");
    expect(result.ok).toBe(true);

    const nudgeWrite = state.calls.find(
      (c) => c.table === "guide_nudges" && c.op === "update"
    );
    expect(nudgeWrite?.payload?.state).toBe("dismissed");
    expect(nudgeWrite?.payload?.dismissed_at).toEqual(expect.any(String));
  });

  it("also marks the notification read so it leaves the tray", async () => {
    await dismissGuideNudgeAction("n1");
    const read = state.calls.find(
      (c) => c.table === "notifications" && c.op === "update"
    );
    expect(read?.payload?.read_at).toEqual(expect.any(String));
  });

  it("refuses a notification that is not the caller's", async () => {
    // The `eq` on recipient makes this a null read rather than a
    // refusal. RLS says the same thing underneath.
    state.notification = null;
    const result = await dismissGuideNudgeAction("n1");
    expect(result.ok).toBe(false);
    expect(
      state.calls.some((c) => c.table === "guide_nudges" && c.op === "update")
    ).toBe(false);
  });

  it("still clears a notification whose payload lost its nudge id", async () => {
    // The tray item has to go away either way. A champion stuck with
    // a notification they cannot dismiss is a worse outcome than a
    // measurement that misses one row.
    state.notification = { id: "n1", payload: {} };
    const result = await dismissGuideNudgeAction("n1");
    expect(result.ok).toBe(true);
    expect(
      state.calls.some((c) => c.table === "guide_nudges" && c.op === "update")
    ).toBe(false);
  });
});
