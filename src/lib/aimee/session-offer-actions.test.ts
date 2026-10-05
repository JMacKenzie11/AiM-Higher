import { describe, it, expect, beforeEach, vi } from "vitest";

// Starting a session from Aimee's offer: only from Aimee's own offer
// message, in an open conversation the person owns, for a session they
// could start, in the company they are working in, and once.

const mocks = vi.hoisted(() => {
  const state = {
    message: null as null | { id: string; role: string; content: string; conversation_id: string },
    convo: null as null | { id: string; company_id: string; created_by: string; mode: string; practice_id: string | null },
    started: null as null | { id: string },
    scoped: "co_acme" as string | null,
    gateOk: true,
    agent: { id: "prepare-a-hard-conversation", title: "Prepare a hard conversation", archived: false } as null | {
      id: string;
      title: string;
      archived: boolean;
    },
  };
  const chain = (table: string) => {
    const filters: string[] = [];
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = (col: string) => {
      filters.push(col);
      return c;
    };
    c.maybeSingle = async () => {
      if (table === "coaching_messages") return { data: state.message };
      if (filters.includes("offered_in_message_id")) return { data: state.started };
      return { data: state.convo };
    };
    return c;
  };
  return {
    state,
    client: { from: (table: string) => chain(table) },
    create: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/current-user", () => ({ requireProfile: async () => ({ profile: { id: "u_me", role: "team_member" } }) }));
vi.mock("@/lib/admin/scope", () => ({ getEffectiveCompanyId: async () => mocks.state.scoped }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => mocks.client }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/practices/resolve", () => ({ resolveAgent: async () => mocks.state.agent }));
vi.mock("@/lib/practices/gate", () => ({
  practiceGate: async () => (mocks.state.gateOk ? { ok: true } : { ok: false, message: "no" }),
}));
vi.mock("@/lib/practices/create", () => ({ createPracticeConversation: mocks.create }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: () => {} }));

import { getSessionOfferAction, startOfferedSessionAction } from "./session-offer-actions";

const OFFER =
  'Want to work it through?\n\n```session_offer\n{"session": "prepare-a-hard-conversation", "summary": "Sam has missed the report three weeks running."}\n```';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.message = { id: "msg_1", role: "assistant", content: OFFER, conversation_id: "conv_1" };
  mocks.state.convo = { id: "conv_1", company_id: "co_acme", created_by: "u_me", mode: "general", practice_id: null };
  mocks.state.started = null;
  mocks.state.scoped = "co_acme";
  mocks.state.gateOk = true;
  mocks.state.agent = { id: "prepare-a-hard-conversation", title: "Prepare a hard conversation", archived: false };
  mocks.create.mockResolvedValue({ ok: true, item: { id: "conv_new" } });
});

describe("startOfferedSessionAction", () => {
  it("starts the offered session with the summary from the saved message", async () => {
    expect(await startOfferedSessionAction("msg_1")).toEqual({ ok: true, conversationId: "conv_new" });
    expect(mocks.create).toHaveBeenCalledWith("prepare-a-hard-conversation", {
      handoffSummary: "Sam has missed the report three weeks running.",
      offeredInMessageId: "msg_1",
    });
  });

  it("opens the session this offer already started rather than another", async () => {
    mocks.state.started = { id: "conv_earlier" };
    expect(await startOfferedSessionAction("msg_1")).toEqual({ ok: true, conversationId: "conv_earlier" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("two clicks at once: the one that lost opens the one that won", async () => {
    mocks.create.mockImplementation(async () => {
      mocks.state.started = { id: "conv_won" };
      return { ok: false, message: "Couldn't start that practice." };
    });
    expect(await startOfferedSessionAction("msg_1")).toEqual({ ok: true, conversationId: "conv_won" });
  });

  it("refuses a conversation somebody else owns", async () => {
    mocks.state.convo = { ...mocks.state.convo!, created_by: "u_other" };
    expect((await startOfferedSessionAction("msg_1")).ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses an offer inside a session or a coaching conversation about a person", async () => {
    mocks.state.convo = { ...mocks.state.convo!, practice_id: "ask-better-questions" };
    expect((await startOfferedSessionAction("msg_1")).ok).toBe(false);
    mocks.state.convo = { ...mocks.state.convo!, practice_id: null, mode: "about" };
    expect((await startOfferedSessionAction("msg_1")).ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses a message that is not Aimee's offer", async () => {
    mocks.state.message = { ...mocks.state.message!, role: "user" };
    expect((await startOfferedSessionAction("msg_1")).ok).toBe(false);
    mocks.state.message = { ...mocks.state.message!, role: "assistant", content: "No offer here." };
    expect((await startOfferedSessionAction("msg_1")).ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses a session this person could not start", async () => {
    mocks.state.gateOk = false;
    expect(await startOfferedSessionAction("msg_1")).toEqual({ ok: false, message: "That session isn't available to you." });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("asks a person working in another company to switch back first", async () => {
    mocks.state.scoped = "co_other";
    const r = await startOfferedSessionAction("msg_1");
    expect(r.ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("getSessionOfferAction", () => {
  it("gives the session's name and whether this offer started one", async () => {
    expect(await getSessionOfferAction("msg_1")).toEqual({
      ok: true,
      title: "Prepare a hard conversation",
      startedConversationId: null,
    });
    mocks.state.started = { id: "conv_earlier" };
    expect(await getSessionOfferAction("msg_1")).toMatchObject({ startedConversationId: "conv_earlier" });
  });

  it("tells anyone but the owner that it is not theirs to start", async () => {
    mocks.state.convo = { ...mocks.state.convo!, created_by: "u_other" };
    expect(await getSessionOfferAction("msg_1")).toEqual({
      ok: false,
      message: "Only the person who had this conversation can start it.",
    });
  });
});
