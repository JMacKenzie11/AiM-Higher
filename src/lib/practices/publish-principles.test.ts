import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";

// Publishing an agent names the principles check the person read, and
// is held to it (0256): the same agent and prompt, the principles as
// they are now, and a reason when the check found something.

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const PROMPT = "Coach the leader.";
const PRINCIPLES = "## Ask one question at a time";

const mocks = vi.hoisted(() => {
  const state = {
    check: null as null | Record<string, unknown>,
    inserted: [] as Array<Record<string, unknown>>,
  };
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => ({
      data:
        table === "agent_principles_checks"
          ? state.check
          : {
              prompt: "Coach the leader.",
              chips: [],
              base_prompt_mode: "full_coach",
              skip_setup: false,
              first_turn: null,
              scripted_opener: null,
              tools: [],
              max_tokens: null,
              model: null,
            },
    });
    c.then = (resolve: (v: unknown) => void) => resolve({ data: [] });
    c.insert = (row: Record<string, unknown>) => {
      state.inserted.push(row);
      return { select: () => ({ single: async () => ({ data: { id: "v_new" }, error: null }) }) };
    };
    c.update = () => ({ eq: async () => ({ error: null }) });
    return c;
  };
  return { state, client: { from: chain } };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/current-user", () => ({ requireRole: async () => ({ profile: { id: "u_admin" } }) }));
vi.mock("@/lib/instances/primary", () => ({ refuseIfNotAuthoringInstance: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => mocks.client }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/coach/principles", () => ({ loadCoachingPrinciples: async () => "## Ask one question at a time" }));

import { publishDraftAction } from "./version-actions";

const check = (over: Record<string, unknown> = {}) => ({
  id: "chk_1",
  agent_id: "a_1",
  prompt_sha: sha(PROMPT),
  principles_sha: sha(PRINCIPLES),
  status: "checked",
  conflicts: [],
  ...over,
});

beforeEach(() => {
  mocks.state.inserted = [];
  mocks.state.check = check();
});

describe("publishDraftAction and the principles check", () => {
  it("records a clean check, with no reason", async () => {
    expect(await publishDraftAction("a_1", "v_1", "notes", { checkId: "chk_1", reason: "" })).toEqual({ ok: true, versionId: "v_new" });
    expect(mocks.state.inserted[0]).toMatchObject({ principles_check_id: "chk_1", principles_reason: null });
  });

  it("needs a reason when the check found something, and keeps it", async () => {
    mocks.state.check = check({ conflicts: [{ principle: "Ask one question at a time", quote: "x", why: "y" }] });
    const refused = await publishDraftAction("a_1", "v_1", "notes", { checkId: "chk_1", reason: "  " });
    expect(refused).toMatchObject({ ok: false, message: expect.stringMatching(/why you are publishing/) });
    expect(mocks.state.inserted).toEqual([]);
    await publishDraftAction("a_1", "v_1", "notes", { checkId: "chk_1", reason: "It works with problems by design." });
    expect(mocks.state.inserted[0]).toMatchObject({ principles_check_id: "chk_1", principles_reason: "It works with problems by design." });
  });

  it("needs a reason when the check could not run", async () => {
    mocks.state.check = check({ status: "failed" });
    expect((await publishDraftAction("a_1", "v_1", "notes", { checkId: "chk_1", reason: "" })).ok).toBe(false);
  });

  it("refuses a check of another prompt, another agent, or older principles", async () => {
    for (const over of [{ prompt_sha: sha("an older prompt") }, { agent_id: "a_2" }, { principles_sha: sha("older principles") }]) {
      mocks.state.check = check(over);
      expect((await publishDraftAction("a_1", "v_1", "notes", { checkId: "chk_1", reason: "a reason" })).ok, JSON.stringify(over)).toBe(false);
    }
    mocks.state.check = null;
    expect((await publishDraftAction("a_1", "v_1", "notes", { checkId: "chk_x", reason: "a reason" })).ok).toBe(false);
    expect(mocks.state.inserted).toEqual([]);
  });
});
