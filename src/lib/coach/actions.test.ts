import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/coach/actions.ts. These pin the
// scope guards (self-coach block, admin/manager reach, feature gates),
// ownership guards (archive/rename), and the two subtle behaviors in
// generateConversationTitleAction: only touch default titles, and
// re-check the title right before writing so a mid-flight user rename
// isn't stomped. Every real dependency is stubbed at the module level.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  // profiles chainables — coaching only ever reads from profiles.
  const profilesSelectMaybeSingle = vi.fn();

  // coaching_conversations chainables. The action file uses three
  // shapes:
  //   .insert(...).select("*").single()
  //   .select("...").eq(...).maybeSingle()
  //   .update({...}).eq(...)
  const conversationsInsertPatch = vi.fn();
  const conversationsInsertSingle = vi.fn();
  const conversationsSelectMaybeSingle = vi.fn();
  const conversationsUpdatePatch = vi.fn();
  const conversationsUpdateEq = vi.fn();
  // For generateConversationTitleAction's "re-read the title right
  // before writing" race guard: the SECOND select on coaching_conversations
  // returns fresh row state.
  const conversationsSelectMaybeSingleFresh = vi.fn();

  // coaching_messages: .select(...).eq(...).order(...).limit(N).
  // Return value is what limit() resolves to.
  const messagesLimit = vi.fn();

  // Per-test counter for coaching_conversations selects. The counter
  // MUST live outside fromBuilder — each .from("coaching_conversations")
  // call returns a fresh builder, and inside generateConversationTitleAction
  // we .from() twice (initial read + fresh re-read pre-write). A
  // builder-local counter would reset on the second .from() and the
  // race-guard test would never see the fresh spy.
  const conversationSelectCallCount = { n: 0 };

  const fromBuilder = (table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: profilesSelectMaybeSingle }),
        }),
      };
    }
    if (table === "coaching_conversations") {
      return {
        insert: (patch: unknown) => {
          conversationsInsertPatch(patch);
          return {
            select: () => ({ single: conversationsInsertSingle }),
          };
        },
        // Two different select shapes hit this table in one action:
        // the first (before the model call) and the "fresh" re-read
        // (right before the write). We route by call order so tests
        // can prime them independently.
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              conversationSelectCallCount.n += 1;
              return conversationSelectCallCount.n === 1
                ? conversationsSelectMaybeSingle()
                : conversationsSelectMaybeSingleFresh();
            },
          }),
        }),
        update: (patch: unknown) => {
          conversationsUpdatePatch(patch);
          return { eq: conversationsUpdateEq };
        },
      };
    }
    if (table === "coaching_messages") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ limit: messagesLimit }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };

  const requireProfile = vi.fn();
  const getEffectiveCompanyId = vi.fn();
  const companyHasFeature = vi.fn();
  const cleanGeneratedTitle = vi.fn();
  const logCoachTokenUsage = vi.fn();
  const revalidatePath = vi.fn();

  // Anthropic SDK is dynamically imported inside the action. We mock
  // the default export as a class whose instance has messages.create.
  const anthropicMessagesCreate = vi.fn();

  return {
    profilesSelectMaybeSingle,
    conversationsInsertPatch,
    conversationsInsertSingle,
    conversationsSelectMaybeSingle,
    conversationsSelectMaybeSingleFresh,
    conversationsUpdatePatch,
    conversationsUpdateEq,
    messagesLimit,
    conversationSelectCallCount,
    serverClient,
    requireProfile,
    getEffectiveCompanyId,
    companyHasFeature,
    cleanGeneratedTitle,
    logCoachTokenUsage,
    revalidatePath,
    anthropicMessagesCreate,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("@/lib/admin/scope", () => ({
  getEffectiveCompanyId: mocks.getEffectiveCompanyId,
}));

vi.mock("@/lib/subscriptions/service", () => ({
  companyHasFeature: mocks.companyHasFeature,
}));

vi.mock("@/lib/coach/title", () => ({
  cleanGeneratedTitle: mocks.cleanGeneratedTitle,
}));

vi.mock("@/lib/coach/usage", () => ({
  logCoachTokenUsage: mocks.logCoachTokenUsage,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// The action does `await import("@anthropic-ai/sdk")` and calls new
// on the default export. Provide a class whose messages.create is our
// spy so tests can shape the model response.
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = { create: mocks.anthropicMessagesCreate };
  }
  return { default: FakeAnthropic };
});

// ---- Helpers --------------------------------------------------
function sessionFor(profile: {
  id?: string;
  role?: "system_admin" | "company_admin" | "team_member" | "aims_guide";
  company_id?: string | null;
}) {
  // Preserve an explicitly-passed null for company_id — using ?? here
  // would silently coerce null back to the default and mask "scope
  // missing" test cases.
  return {
    profile: {
      id: profile.id ?? "caller_1",
      role: profile.role ?? "team_member",
      company_id:
        "company_id" in profile ? profile.company_id : "co_acme",
    },
  };
}

function primeHappyPath() {
  // Reset the shared counter that routes coaching_conversations
  // selects to the initial vs "fresh re-read" spy.
  mocks.conversationSelectCallCount.n = 0;
  mocks.getEffectiveCompanyId.mockResolvedValue("co_acme");
  mocks.companyHasFeature.mockResolvedValue(true);
  // Default subject: someone in the caller's company, no direct-report link.
  mocks.profilesSelectMaybeSingle.mockResolvedValue({
    data: {
      id: "subject_1",
      company_id: "co_acme",
      reports_to: null,
    },
    error: null,
  });
  mocks.conversationsInsertSingle.mockResolvedValue({
    data: {
      id: "conv_new",
      company_id: "co_acme",
      subject_profile_id: "subject_1",
      created_by: "caller_1",
      title: "Coaching · Aug 12",
      archived: false,
      context_kind: "execution",
      mode: "about",
      practice_id: null,
      partner_profile_id: null,
      created_at: "2026-08-12T00:00:00Z",
      updated_at: "2026-08-12T00:00:00Z",
    },
    error: null,
  });
  mocks.conversationsSelectMaybeSingle.mockResolvedValue({
    data: {
      id: "conv_1",
      title: "Coaching · Aug 12",
      created_by: "caller_1",
      subject_profile_id: "subject_1",
      mode: "about",
      company_id: "co_acme",
    },
    error: null,
  });
  mocks.conversationsSelectMaybeSingleFresh.mockResolvedValue({
    data: { title: "Coaching · Aug 12" },
    error: null,
  });
  mocks.conversationsUpdateEq.mockResolvedValue({ error: null });
  mocks.messagesLimit.mockResolvedValue({
    data: [
      { role: "user", content: "I need help with X" },
      { role: "assistant", content: "Tell me more about X" },
      { role: "user", content: "It's about Y" },
      { role: "assistant", content: "So the real issue is Z" },
    ],
    error: null,
  });
  mocks.cleanGeneratedTitle.mockImplementation((s: string) => s.trim());
  mocks.anthropicMessagesCreate.mockResolvedValue({
    content: [{ type: "text", text: "Navigating a hard conversation" }],
    usage: { input_tokens: 100, output_tokens: 8 },
  });
}

// ==============================================================
// createConversationAction
// ==============================================================
describe("createConversationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("blocks self-coaching (route it through Ask Aimee)", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "same_id", role: "team_member" })
    );
    const { createConversationAction } = await import("./actions");

    const res = await createConversationAction("same_id");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Ask Aimee/);
    expect(mocks.profilesSelectMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.conversationsInsertPatch).not.toHaveBeenCalled();
  });

  it("blocks a team_member who doesn't manage the subject and isn't an admin", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "caller_1", role: "team_member" })
    );
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      // Subject reports to someone ELSE.
      data: { id: "subject_1", company_id: "co_acme", reports_to: "other" },
      error: null,
    });
    const { createConversationAction } = await import("./actions");

    const res = await createConversationAction("subject_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/direct reports/);
    expect(mocks.conversationsInsertPatch).not.toHaveBeenCalled();
  });

  it("blocks a company_admin acting on someone in a different company", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "admin_1", role: "company_admin", company_id: "co_acme" })
    );
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "subject_1", company_id: "co_other", reports_to: null },
      error: null,
    });
    const { createConversationAction } = await import("./actions");

    const res = await createConversationAction("subject_1");

    expect(res.ok).toBe(false);
    expect(mocks.conversationsInsertPatch).not.toHaveBeenCalled();
  });

  it("blocks strengths coaching when the company lacks the entitlement", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "admin_1", role: "company_admin", company_id: "co_acme" })
    );
    mocks.companyHasFeature.mockResolvedValueOnce(false);
    const { createConversationAction } = await import("./actions");

    const res = await createConversationAction("subject_1", "strengths");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Strengths coaching isn't enabled/);
    expect(mocks.companyHasFeature).toHaveBeenCalledWith("co_acme", "strengths");
    expect(mocks.conversationsInsertPatch).not.toHaveBeenCalled();
  });

  it("inserts an 'about' conversation with the subject's company + caller as created_by", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "admin_1", role: "system_admin" })
    );
    const { createConversationAction } = await import("./actions");

    const res = await createConversationAction("subject_1");

    expect(res.ok).toBe(true);
    expect(mocks.conversationsInsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: "co_acme",
        subject_profile_id: "subject_1",
        created_by: "admin_1",
        mode: "about",
        context_kind: "execution",
      })
    );
  });
});

// ==============================================================
// createGeneralConversationAction
// ==============================================================
describe("createGeneralConversationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when a system_admin has no company scoped in", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "root", role: "system_admin", company_id: null })
    );
    mocks.getEffectiveCompanyId.mockResolvedValueOnce(null);
    const { createGeneralConversationAction } = await import("./actions");

    const res = await createGeneralConversationAction();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Scope into a company/);
    expect(mocks.conversationsInsertPatch).not.toHaveBeenCalled();
  });

  it("inserts with mode='general' and a null subject", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "member_1", role: "team_member", company_id: "co_acme" })
    );
    // Insert response for the general shape: subject_profile_id null.
    mocks.conversationsInsertSingle.mockResolvedValueOnce({
      data: {
        id: "conv_new",
        company_id: "co_acme",
        subject_profile_id: null,
        created_by: "member_1",
        title: "Coaching · Aug 12",
        archived: false,
        context_kind: "execution",
        mode: "general",
        practice_id: null,
        partner_profile_id: null,
        created_at: "2026-08-12T00:00:00Z",
        updated_at: "2026-08-12T00:00:00Z",
      },
      error: null,
    });
    const { createGeneralConversationAction } = await import("./actions");

    const res = await createGeneralConversationAction();

    expect(res.ok).toBe(true);
    expect(mocks.conversationsInsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: "co_acme",
        subject_profile_id: null,
        mode: "general",
      })
    );
  });
});

// ==============================================================
// archiveConversationAction
// ==============================================================
describe("archiveConversationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks a non-owner from archiving", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "someone_else" })
    );
    // The primed conversation was created_by: "caller_1", so the caller
    // here is not the owner.
    const { archiveConversationAction } = await import("./actions");

    const res = await archiveConversationAction("conv_1");

    expect(res).toEqual({ ok: false, message: "Not yours to archive." });
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("archives when the caller is the owner", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { archiveConversationAction } = await import("./actions");

    const res = await archiveConversationAction("conv_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.conversationsUpdatePatch).toHaveBeenCalledWith({
      archived: true,
    });
  });
});

// ==============================================================
// renameConversationAction
// ==============================================================
describe("renameConversationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an empty (or whitespace-only) title", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { renameConversationAction } = await import("./actions");

    const res = await renameConversationAction("conv_1", "   ");

    expect(res).toEqual({ ok: false, message: "Title can't be empty." });
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("clamps the stored title to 120 chars", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const long = "x".repeat(250);
    const { renameConversationAction } = await import("./actions");

    await renameConversationAction("conv_1", long);

    expect(mocks.conversationsUpdatePatch).toHaveBeenCalledTimes(1);
    const patch = mocks.conversationsUpdatePatch.mock.calls[0][0] as {
      title: string;
    };
    expect(patch.title.length).toBe(120);
  });

  it("blocks a non-owner from renaming", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "someone_else" })
    );
    const { renameConversationAction } = await import("./actions");

    const res = await renameConversationAction("conv_1", "New title");

    expect(res).toEqual({ ok: false, message: "Not yours to rename." });
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });
});

// ==============================================================
// generateConversationTitleAction — the subtle one
// ==============================================================
describe("generateConversationTitleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("no-ops (title:null) when the current title isn't a default — respects a user rename", async () => {
    // A user-renamed title must never be replaced by the auto-title.
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    mocks.conversationsSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "conv_1",
        title: "How I stopped micromanaging",
        created_by: "caller_1",
        subject_profile_id: "subject_1",
        mode: "about",
        company_id: "co_acme",
      },
      error: null,
    });
    const { generateConversationTitleAction } = await import("./actions");

    const res = await generateConversationTitleAction("conv_1");

    expect(res).toEqual({ ok: true, title: null });
    expect(mocks.anthropicMessagesCreate).not.toHaveBeenCalled();
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("no-ops when there are fewer than 4 messages", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    mocks.messagesLimit.mockResolvedValueOnce({
      data: [
        { role: "user", content: "I need help" },
        { role: "assistant", content: "With what?" },
      ],
      error: null,
    });
    const { generateConversationTitleAction } = await import("./actions");

    const res = await generateConversationTitleAction("conv_1");

    expect(res).toEqual({ ok: true, title: null });
    expect(mocks.anthropicMessagesCreate).not.toHaveBeenCalled();
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a non-owner from triggering auto-title", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "not_owner" }));
    const { generateConversationTitleAction } = await import("./actions");

    const res = await generateConversationTitleAction("conv_1");

    expect(res).toEqual({ ok: false, message: "Not yours." });
    expect(mocks.anthropicMessagesCreate).not.toHaveBeenCalled();
  });

  it("does NOT stomp on a mid-flight user rename", async () => {
    // Contract: re-read the title right before writing. If the user
    // renamed during the ~1s model call, treat that as a manual edit
    // and skip the write. This is the race check the action file
    // calls out explicitly, and it would silently regress with a
    // "just await the update()" refactor.
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    // Fresh re-read returns a non-default title: user renamed while
    // the model call was in flight.
    mocks.conversationsSelectMaybeSingleFresh.mockResolvedValueOnce({
      data: { title: "My own better title" },
      error: null,
    });
    const { generateConversationTitleAction } = await import("./actions");

    const res = await generateConversationTitleAction("conv_1");

    expect(res).toEqual({ ok: true, title: null });
    // Model call did fire (title was default when we entered) but we
    // MUST NOT have written over the user's rename.
    expect(mocks.anthropicMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("writes the generated title on the happy path and logs token usage", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { generateConversationTitleAction } = await import("./actions");

    const res = await generateConversationTitleAction("conv_1");

    expect(res).toEqual({
      ok: true,
      title: "Navigating a hard conversation",
    });
    expect(mocks.conversationsUpdatePatch).toHaveBeenCalledWith({
      title: "Navigating a hard conversation",
    });
    // Usage logging is fire-and-forget (void logCoachTokenUsage(...))
    // but the call must still fire so billing/attribution isn't lost.
    expect(mocks.logCoachTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_1",
        companyId: "co_acme",
        purpose: "title",
        model: "claude-haiku-4-5",
      })
    );
  });

  it("errors gracefully when the model call throws", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    mocks.anthropicMessagesCreate.mockRejectedValueOnce(
      new Error("upstream 500")
    );
    const { generateConversationTitleAction } = await import("./actions");

    const res = await generateConversationTitleAction("conv_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Couldn't summarize/);
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("errors when ANTHROPIC_API_KEY isn't configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { generateConversationTitleAction } = await import("./actions");

    const res = await generateConversationTitleAction("conv_1");

    expect(res).toEqual({ ok: false, message: "Model not configured." });
    expect(mocks.anthropicMessagesCreate).not.toHaveBeenCalled();
  });
});
