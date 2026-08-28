import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/practices/actions.ts. Practices are
// stored as general (Ask Aimee) conversations with a practice_id set
// — so the same RLS + shape constraints (migration 0105) apply. These
// tests pin the practice-specific extras: registry lookup, company
// scoping on create, and the partner-picker guard set (owner-only,
// no self-partnering, same-company only).

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const conversationsInsertPatch = vi.fn();
  const conversationsInsertSingle = vi.fn();
  const conversationsSelectMaybeSingle = vi.fn();
  const conversationsUpdatePatch = vi.fn();
  const conversationsUpdateEq = vi.fn();

  const profilesSelectMaybeSingle = vi.fn();

  const messagesInsertPatch = vi.fn(async (_patch: unknown) => ({
    error: null,
  }));

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
          return { select: () => ({ single: conversationsInsertSingle }) };
        },
        select: () => ({
          eq: () => ({ maybeSingle: conversationsSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          conversationsUpdatePatch(patch);
          return { eq: conversationsUpdateEq };
        },
      };
    }
    if (table === "coaching_messages") {
      return {
        insert: (patch: unknown) => messagesInsertPatch(patch),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireProfile = vi.fn();
  const getScopedCompanyId = vi.fn();
  const findPractice = vi.fn();
  const revalidatePath = vi.fn();

  return {
    conversationsInsertPatch,
    conversationsInsertSingle,
    conversationsSelectMaybeSingle,
    conversationsUpdatePatch,
    conversationsUpdateEq,
    profilesSelectMaybeSingle,
    messagesInsertPatch,
    serverClient,
    requireProfile,
    getScopedCompanyId,
    findPractice,
    revalidatePath,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("@/lib/admin/scope", () => ({
  getScopedCompanyId: mocks.getScopedCompanyId,
}));

vi.mock("./registry", () => ({
  findPractice: mocks.findPractice,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// ---- Helpers --------------------------------------------------
function sessionFor(profile: {
  id?: string;
  role?: "system_admin" | "company_admin" | "team_member" | "aims_guide";
  company_id?: string | null;
  guide_company_ids?: readonly string[];
}) {
  // Preserve an explicitly-passed null for company_id — ?? would
  // silently coerce it to the default and mask scope tests.
  return {
    profile: {
      id: profile.id ?? "caller_1",
      role: profile.role ?? "team_member",
      company_id:
        "company_id" in profile ? profile.company_id : "co_acme",
      guide_company_ids: profile.guide_company_ids ?? [],
    },
  };
}

function primeHappyPath() {
  mocks.findPractice.mockReturnValue({
    id: "prepare-a-hard-conversation",
    title: "Prepare a hard conversation",
  });
  mocks.getScopedCompanyId.mockResolvedValue("co_acme");
  mocks.conversationsInsertSingle.mockResolvedValue({
    data: {
      id: "conv_new",
      company_id: "co_acme",
      subject_profile_id: null,
      created_by: "caller_1",
      title: "Aug 12",
      archived: false,
      context_kind: "execution",
      mode: "general",
      practice_id: "prepare-a-hard-conversation",
      partner_profile_id: null,
      created_at: "2026-08-12T00:00:00Z",
      updated_at: "2026-08-12T00:00:00Z",
    },
    error: null,
  });
  mocks.conversationsSelectMaybeSingle.mockResolvedValue({
    data: {
      id: "conv_1",
      created_by: "caller_1",
      company_id: "co_acme",
      practice_id: "prepare-a-hard-conversation",
    },
    error: null,
  });
  mocks.conversationsUpdateEq.mockResolvedValue({ error: null });
  mocks.profilesSelectMaybeSingle.mockResolvedValue({
    data: { id: "partner_1", company_id: "co_acme" },
    error: null,
  });
}

// ==============================================================
// createPracticeConversationAction
// ==============================================================
describe("createPracticeConversationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an unknown practice id before touching the DB", async () => {
    mocks.findPractice.mockReturnValueOnce(null);
    mocks.requireProfile.mockResolvedValue(sessionFor({}));
    const { createPracticeConversationAction } = await import("./actions");

    const res = await createPracticeConversationAction("does-not-exist");

    expect(res).toEqual({
      ok: false,
      message: "That practice isn't available.",
    });
    expect(mocks.conversationsInsertPatch).not.toHaveBeenCalled();
  });

  it("errors when a system_admin has no company scoped in", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "root", role: "system_admin", company_id: null })
    );
    mocks.getScopedCompanyId.mockResolvedValueOnce(null);
    const { createPracticeConversationAction } = await import("./actions");

    const res = await createPracticeConversationAction(
      "prepare-a-hard-conversation"
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Scope into a company/);
    expect(mocks.conversationsInsertPatch).not.toHaveBeenCalled();
  });

  it("inserts with mode='general', practice_id set, subject null", async () => {
    // The stored shape MUST keep mode='general' and
    // subject_profile_id=null so the existing coaching_conversations
    // constraint + RLS insert policy accept the row.
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "member_1", company_id: "co_acme" })
    );
    const { createPracticeConversationAction } = await import("./actions");

    const res = await createPracticeConversationAction(
      "prepare-a-hard-conversation"
    );

    expect(res.ok).toBe(true);
    expect(mocks.conversationsInsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: "co_acme",
        subject_profile_id: null,
        mode: "general",
        practice_id: "prepare-a-hard-conversation",
        created_by: "member_1",
      })
    );
  });

  it("denies a team_member on a role-gated practice before touching the DB", async () => {
    mocks.findPractice.mockReturnValueOnce({
      id: "functional-chart-builder",
      title: "Functional Chart Builder",
      allowedRoles: ["company_admin", "system_admin", "aims_guide"],
    });
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "team_1", role: "team_member", company_id: "co_acme" })
    );
    const { createPracticeConversationAction } = await import("./actions");

    const res = await createPracticeConversationAction("functional-chart-builder");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/isn't available/i);
    expect(mocks.conversationsInsertPatch).not.toHaveBeenCalled();
  });

  it("denies an aims_guide on a company they aren't assigned to", async () => {
    mocks.findPractice.mockReturnValueOnce({
      id: "functional-chart-builder",
      title: "Functional Chart Builder",
      allowedRoles: ["company_admin", "system_admin", "aims_guide"],
    });
    mocks.requireProfile.mockResolvedValue(
      sessionFor({
        id: "guide_1",
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_meridian"],
      })
    );
    mocks.getScopedCompanyId.mockResolvedValueOnce("co_acme");
    const { createPracticeConversationAction } = await import("./actions");

    const res = await createPracticeConversationAction("functional-chart-builder");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/aren't assigned/i);
    expect(mocks.conversationsInsertPatch).not.toHaveBeenCalled();
  });

  it("persists a scriptedOpener as an assistant message with no API call", async () => {
    // Scripted-opener practices need to show the opener in the UI
    // without spinning up the model — the opener is authored copy,
    // not a generated turn. Assert we INSERT into coaching_messages
    // with role='assistant' and the exact text.
    const opener = "Let's build a clear Functional Accountability Chart.";
    mocks.findPractice.mockReturnValueOnce({
      id: "functional-chart-builder",
      title: "Functional Chart Builder",
      allowedRoles: ["company_admin", "system_admin", "aims_guide"],
      scriptedOpener: opener,
    });
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "admin_1", role: "company_admin", company_id: "co_acme" })
    );
    const { createPracticeConversationAction } = await import("./actions");

    const res = await createPracticeConversationAction("functional-chart-builder");

    expect(res.ok).toBe(true);
    expect(mocks.messagesInsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conv_new",
        created_by: "admin_1",
        role: "assistant",
        content: opener,
      })
    );
  });

  it("does not insert a scripted opener when the practice has none", async () => {
    // The three legacy practices don't declare a scriptedOpener; a
    // stray insert would show a phantom assistant message on load.
    mocks.requireProfile.mockResolvedValue(sessionFor({}));
    const { createPracticeConversationAction } = await import("./actions");

    await createPracticeConversationAction("prepare-a-hard-conversation");

    expect(mocks.messagesInsertPatch).not.toHaveBeenCalled();
  });

  it("stores a bare date as the title (list renderer prepends the practice title)", async () => {
    // "Prepare a hard conversation · Aug 10" as the stored title would
    // double up in the Ask Aimee list because the renderer already
    // shows the practice title as a muted prefix. Bare "Aug 10" also
    // matches the auto-title default pattern, so it gets replaced with
    // a real summary after a few exchanges.
    mocks.requireProfile.mockResolvedValue(sessionFor({}));
    const { createPracticeConversationAction } = await import("./actions");

    await createPracticeConversationAction("prepare-a-hard-conversation");

    const patch = mocks.conversationsInsertPatch.mock
      .calls[0][0] as { title: string };
    expect(patch.title).not.toMatch(/·/);
    expect(patch.title).not.toContain("Prepare a hard conversation");
    // Bare "Mon D" or "Mon DD" (locale-dependent, so match loosely).
    expect(patch.title.length).toBeGreaterThan(0);
    expect(patch.title.length).toBeLessThan(15);
  });
});

// ==============================================================
// setPracticePartnerAction
// ==============================================================
describe("setPracticePartnerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when the conversation isn't found", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    mocks.conversationsSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { setPracticePartnerAction } = await import("./actions");

    const res = await setPracticePartnerAction("conv_missing", "partner_1");

    expect(res).toEqual({ ok: false, message: "Conversation not found." });
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a non-owner from setting the partner", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "someone_else" }));
    const { setPracticePartnerAction } = await import("./actions");

    const res = await setPracticePartnerAction("conv_1", "partner_1");

    expect(res).toEqual({ ok: false, message: "Not yours to edit." });
    expect(mocks.profilesSelectMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("refuses to set a partner on a non-practice conversation", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    mocks.conversationsSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "conv_1",
        created_by: "caller_1",
        company_id: "co_acme",
        practice_id: null,
      },
      error: null,
    });
    const { setPracticePartnerAction } = await import("./actions");

    const res = await setPracticePartnerAction("conv_1", "partner_1");

    expect(res).toEqual({
      ok: false,
      message: "This conversation isn't a practice.",
    });
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks the caller from being their own partner", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { setPracticePartnerAction } = await import("./actions");

    const res = await setPracticePartnerAction("conv_1", "caller_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/your own partner/);
    expect(mocks.profilesSelectMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a partner in a different company", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "caller_1", company_id: "co_acme" })
    );
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "partner_1", company_id: "co_other" },
      error: null,
    });
    const { setPracticePartnerAction } = await import("./actions");

    const res = await setPracticePartnerAction("conv_1", "partner_1");

    expect(res).toEqual({
      ok: false,
      message: "That person isn't in your company.",
    });
    expect(mocks.conversationsUpdatePatch).not.toHaveBeenCalled();
  });

  it("clears the partner (null) without looking up any profile", async () => {
    // Clearing is always allowed for the owner — no need to hit the
    // profiles table.
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { setPracticePartnerAction } = await import("./actions");

    const res = await setPracticePartnerAction("conv_1", null);

    expect(res).toEqual({ ok: true });
    expect(mocks.profilesSelectMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.conversationsUpdatePatch).toHaveBeenCalledWith({
      partner_profile_id: null,
    });
  });

  it("attaches a same-company partner", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { setPracticePartnerAction } = await import("./actions");

    const res = await setPracticePartnerAction("conv_1", "partner_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.conversationsUpdatePatch).toHaveBeenCalledWith({
      partner_profile_id: "partner_1",
    });
  });
});
