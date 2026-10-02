import { describe, it, expect, beforeEach, vi } from "vitest";

// Saving Aimee's draft: only the person who started the conversation,
// only from Aimee's own draft message, and once.

const mocks = vi.hoisted(() => {
  const state = {
    convo: null as null | { id: string; company_id: string | null; created_by: string },
    message: null as null | { id: string; role: string; content: string },
    saved: [] as Array<{ id: string; description: string; due_date: string; due_date_defaulted: boolean }>,
  };
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.is = () => c;
    c.maybeSingle = async () => ({ data: result() });
    return c;
  };
  return {
    state,
    client: {
      from: (table: string) => {
        if (table === "coaching_conversations") return chain(() => state.convo);
        if (table === "coaching_messages") return chain(() => state.message);
        if (table === "commitments") return chain(() => state.saved[0] ?? null);
        throw new Error(`Unexpected table: ${table}`);
      },
    },
    createCommitment: vi.fn(),
  };
});

vi.mock("@/lib/auth/current-user", () => ({ requireProfile: async () => ({ profile: { id: "u_me" } }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => mocks.client }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/commitments/create", () => ({ createCommitment: mocks.createCommitment }));
vi.mock("@/lib/commitments/service", () => ({
  getCommitmentLinkOptions: async () => ({ priorityOptions: [], functionalAreaOptions: [] }),
}));

import { getDraftCardStateAction, saveCommitmentDraftAction } from "./commitment-draft-actions";

const DRAFT = 'Here it is.\n\n```commitment\n{"description": "Ask the team", "due_date": null}\n```';
const input = {
  conversationId: "conv_1",
  messageId: "msg_1",
  description: "Ask the team what made it work",
  dueDate: null,
  priorityId: null,
  functionalAreaId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.convo = { id: "conv_1", company_id: "co_acme", created_by: "u_me" };
  mocks.state.message = { id: "msg_1", role: "assistant", content: DRAFT };
  mocks.state.saved = [];
  mocks.createCommitment.mockImplementation(async (_s, i) => ({
    ok: true,
    commitment: { id: "c_new", description: i.description, due_date: "2026-10-09", due_date_defaulted: true },
  }));
});

describe("saveCommitmentDraftAction", () => {
  it("saves the leader's own commitment in the conversation's company, from this message", async () => {
    const r = await saveCommitmentDraftAction(input);
    expect(r).toEqual({ ok: true, saved: { id: "c_new", description: "Ask the team what made it work", due: "By next meeting" } });
    expect(mocks.createCommitment).toHaveBeenCalledWith(
      { profile: { id: "u_me" } },
      expect.objectContaining({ companyId: "co_acme", coachingMessageId: "msg_1", dueDate: null })
    );
    expect(mocks.createCommitment.mock.calls[0][1]).not.toHaveProperty("ownerId");
  });

  it("refuses a conversation somebody else started", async () => {
    mocks.state.convo = { id: "conv_1", company_id: "co_acme", created_by: "u_other" };
    const r = await saveCommitmentDraftAction(input);
    expect(r.ok).toBe(false);
    expect(mocks.createCommitment).not.toHaveBeenCalled();
  });

  it("refuses a message that is not Aimee's draft", async () => {
    mocks.state.message = { id: "msg_1", role: "user", content: DRAFT };
    expect((await saveCommitmentDraftAction(input)).ok).toBe(false);
    mocks.state.message = { id: "msg_1", role: "assistant", content: "No draft here." };
    expect((await saveCommitmentDraftAction(input)).ok).toBe(false);
    expect(mocks.createCommitment).not.toHaveBeenCalled();
  });

  it("saves once: a second press returns the first commitment", async () => {
    mocks.state.saved = [{ id: "c_first", description: "Ask the team", due_date: "2026-10-09", due_date_defaulted: true }];
    const r = await saveCommitmentDraftAction(input);
    expect(r).toEqual({ ok: true, saved: { id: "c_first", description: "Ask the team", due: "By next meeting" } });
    expect(mocks.createCommitment).not.toHaveBeenCalled();
  });

  it("two saves at once: the one that lost reads back the one that won", async () => {
    mocks.createCommitment.mockImplementation(async () => {
      mocks.state.saved = [{ id: "c_won", description: "Ask the team", due_date: "2026-10-09", due_date_defaulted: true }];
      return { ok: false, message: "Couldn't save that commitment." };
    });
    expect(await saveCommitmentDraftAction(input)).toMatchObject({ ok: true, saved: { id: "c_won" } });
  });
});

describe("getDraftCardStateAction", () => {
  it("is null for anyone but the person who started it", async () => {
    mocks.state.convo = { id: "conv_1", company_id: "co_acme", created_by: "u_other" };
    expect(await getDraftCardStateAction("conv_1", "msg_1")).toBeNull();
  });

  it("says whether it is saved", async () => {
    expect(await getDraftCardStateAction("conv_1", "msg_1")).toEqual({ saved: null, priorityOptions: [], functionalAreaOptions: [] });
  });
});
