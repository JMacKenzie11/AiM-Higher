import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/transcripts/actions.ts. The two
// security-critical branches are (1) shared-scope sources — those
// with company_id=null — must only be manageable by system_admin
// (a company_admin passing the source id in a form MUST NOT be able
// to pause/resume/remove them), and (2) company-scoped actions must
// go through isAdminForCompany so a company_admin can't reach into
// another tenant's sources.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const sourcesSelectMaybeSingle = vi.fn();
  const sourcesInsertPatch = vi.fn();
  const sourcesInsertSingle = vi.fn();
  const sourcesUpdatePatch = vi.fn();
  const sourcesUpdateEq = vi.fn();
  const sourcesDeleteEq = vi.fn();

  const meetingsSelectMaybeSingle = vi.fn();
  const meetingsUpdatePatch = vi.fn();
  const meetingsUpdateEq = vi.fn();

  const aliasesSelectMaybeSingle = vi.fn();
  const aliasesInsert = vi.fn();
  const aliasesDeleteEq = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "transcript_sources") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: sourcesSelectMaybeSingle }),
        }),
        insert: (patch: unknown) => {
          sourcesInsertPatch(patch);
          return { select: () => ({ single: sourcesInsertSingle }) };
        },
        update: (patch: unknown) => {
          sourcesUpdatePatch(patch);
          return { eq: sourcesUpdateEq };
        },
        delete: () => ({ eq: () => sourcesDeleteEq() }),
      };
    }
    if (table === "meetings") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: meetingsSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          meetingsUpdatePatch(patch);
          return {
            eq: meetingsUpdateEq,
          };
        },
      };
    }
    if (table === "transcript_aliases") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: aliasesSelectMaybeSingle }),
        }),
        insert: aliasesInsert,
        delete: () => ({ eq: () => aliasesDeleteEq() }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const admin = { from: fromBuilder };
  const requireProfile = vi.fn();
  const transcriptSourcesAllowed = vi.fn();
  const isAdminForCompany = vi.fn();
  const ingestSource = vi.fn();
  const processPendingMeetings = vi.fn();
  const getProvider = vi.fn();
  const parseGoogleFolderId = vi.fn();
  const revalidatePath = vi.fn();

  return {
    sourcesSelectMaybeSingle,
    sourcesInsertPatch,
    sourcesInsertSingle,
    sourcesUpdatePatch,
    sourcesUpdateEq,
    sourcesDeleteEq,
    meetingsSelectMaybeSingle,
    meetingsUpdatePatch,
    meetingsUpdateEq,
    aliasesSelectMaybeSingle,
    aliasesInsert,
    aliasesDeleteEq,
    admin,
    requireProfile,
    transcriptSourcesAllowed,
    isAdminForCompany,
    ingestSource,
    processPendingMeetings,
    getProvider,
    parseGoogleFolderId,
    revalidatePath,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("@/lib/auth/permissions", () => ({
  transcriptSourcesAllowed: mocks.transcriptSourcesAllowed,
  isAdminForCompany: mocks.isAdminForCompany,
}));

vi.mock("./ingest", () => ({
  ingestSource: mocks.ingestSource,
  processPendingMeetings: mocks.processPendingMeetings,
}));

vi.mock("./provider", () => ({
  getProvider: mocks.getProvider,
}));

// parseGoogleFolderId now lives in its own dependency-free module so
// actions.ts doesn't drag `googleapis` into every consumer. Mock the
// module actions.ts actually imports.
vi.mock("./providers/drive-url", () => ({
  parseGoogleFolderId: mocks.parseGoogleFolderId,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// ---- Helpers --------------------------------------------------
function formDataFrom(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

function primeHappyPath() {
  mocks.transcriptSourcesAllowed.mockReturnValue(true);
  mocks.isAdminForCompany.mockReturnValue(true);
  mocks.requireProfile.mockResolvedValue({
    profile: { id: "root", role: "system_admin", company_id: null },
  });
  mocks.sourcesSelectMaybeSingle.mockResolvedValue({
    data: { id: "src_1", company_id: "co_acme" },
    error: null,
  });
  mocks.sourcesUpdateEq.mockResolvedValue({ error: null });
  mocks.sourcesDeleteEq.mockResolvedValue({ error: null });
  // Default meeting is unrouted (company_id null): the happy-path
  // caller is a system_admin, who may route those.
  mocks.meetingsSelectMaybeSingle.mockResolvedValue({
    data: { company_id: null },
    error: null,
  });
  mocks.meetingsUpdateEq.mockResolvedValue({ error: null });
  mocks.aliasesSelectMaybeSingle.mockResolvedValue({
    data: { company_id: "co_acme" },
    error: null,
  });
  mocks.aliasesInsert.mockResolvedValue({ error: null });
  mocks.aliasesDeleteEq.mockResolvedValue({ error: null });
}

// The real isAdminForCompany rule for a company_admin: their own
// company and nothing else. Tests that exercise the tenant boundary
// swap this in so the guard is checked against a real comparison
// rather than a blanket true.
function useRealCompanyAdminRule() {
  mocks.isAdminForCompany.mockImplementation(
    (profile: { role: string; company_id: string | null }, companyId: string) =>
      profile.role === "system_admin" || profile.company_id === companyId
  );
}

function companyAdminOf(companyId: string) {
  mocks.requireProfile.mockResolvedValue({
    profile: { id: "admin_1", role: "company_admin", company_id: companyId },
  });
}

// ==============================================================
// guard: transcriptSourcesAllowed
// ==============================================================
describe("guard (transcriptSourcesAllowed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects any caller who lacks transcript-source permission", async () => {
    mocks.transcriptSourcesAllowed.mockReturnValue(false);
    const { pauseSourceAction } = await import("./actions");

    const res = await pauseSourceAction("src_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/don't have access/);
    expect(mocks.sourcesUpdateEq).not.toHaveBeenCalled();
  });
});

// ==============================================================
// pauseSourceAction — shared-scope security
// ==============================================================
describe("pauseSourceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks a company_admin from pausing a SHARED-scope source (company_id = null)", async () => {
    // Contract: shared-scope sources are system-admin only. If this
    // ever regresses, a company_admin who guesses the source id
    // could pause the global ingest that other tenants also rely on.
    mocks.requireProfile.mockResolvedValue({
      profile: { id: "admin_1", role: "company_admin", company_id: "co_acme" },
    });
    mocks.sourcesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "src_shared", company_id: null },
      error: null,
    });
    const { pauseSourceAction } = await import("./actions");

    const res = await pauseSourceAction("src_shared");

    expect(res).toEqual({ ok: false, message: "Not your source to manage." });
    expect(mocks.sourcesUpdateEq).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from another company for a company-scoped source", async () => {
    mocks.requireProfile.mockResolvedValue({
      profile: { id: "admin_1", role: "company_admin", company_id: "co_other" },
    });
    mocks.isAdminForCompany.mockReturnValueOnce(false);
    mocks.sourcesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "src_1", company_id: "co_acme" },
      error: null,
    });
    const { pauseSourceAction } = await import("./actions");

    const res = await pauseSourceAction("src_1");

    expect(res).toEqual({ ok: false, message: "Not your source to manage." });
    expect(mocks.sourcesUpdateEq).not.toHaveBeenCalled();
  });

  it("allows a system_admin to pause a shared-scope source", async () => {
    mocks.sourcesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "src_shared", company_id: null },
      error: null,
    });
    const { pauseSourceAction } = await import("./actions");

    const res = await pauseSourceAction("src_shared");

    expect(res).toEqual({ ok: true });
    expect(mocks.sourcesUpdatePatch).toHaveBeenCalledWith({ status: "paused" });
  });
});

// ==============================================================
// resumeSourceAction
// ==============================================================
describe("resumeSourceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("clears last_error along with status when resuming", async () => {
    // A resumed source shouldn't still surface the failure that caused
    // it to be paused — otherwise the operator sees a stale "last
    // error" on a source that's now healthy.
    const { resumeSourceAction } = await import("./actions");

    await resumeSourceAction("src_1");

    expect(mocks.sourcesUpdatePatch).toHaveBeenCalledWith({
      status: "active",
      last_error: null,
    });
  });
});

// ==============================================================
// connectGoogleFolderAction
// ==============================================================
describe("connectGoogleFolderAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
    mocks.parseGoogleFolderId.mockReturnValue("folder_abc");
    mocks.getProvider.mockResolvedValue({
      verifyFolderAccess: vi.fn().mockResolvedValue({ folderName: "Meetings" }),
    });
    mocks.sourcesInsertSingle.mockResolvedValue({
      data: {
        id: "src_new",
        company_id: "co_acme",
        scope: "company",
        provider: "google_drive",
        folder_id: "folder_abc",
      },
      error: null,
    });
  });

  it("rejects an invalid scope", async () => {
    const { connectGoogleFolderAction } = await import("./actions");

    const res = await connectGoogleFolderAction(
      formDataFrom({ scope: "totally-fake", folder_url: "x" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/valid scope/);
    expect(mocks.sourcesInsertPatch).not.toHaveBeenCalled();
  });

  it("rejects company-scope without a company_id", async () => {
    const { connectGoogleFolderAction } = await import("./actions");

    const res = await connectGoogleFolderAction(
      formDataFrom({ scope: "company", folder_url: "https://drive.google.com/x" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/company/);
    expect(mocks.sourcesInsertPatch).not.toHaveBeenCalled();
  });

  it("rejects an unparseable folder URL / ID", async () => {
    mocks.parseGoogleFolderId.mockReturnValueOnce(null);
    const { connectGoogleFolderAction } = await import("./actions");

    const res = await connectGoogleFolderAction(
      formDataFrom({
        scope: "company",
        company_id: "co_acme",
        folder_url: "not-a-drive-url",
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/folder URL or ID/);
    expect(mocks.sourcesInsertPatch).not.toHaveBeenCalled();
  });

  it("seeds the cursor to 'now' so the first ingest only picks up NEW files", async () => {
    // Contract: onboarding a folder mustn't drag in every historical
    // transcript. The initial cursor is the connect timestamp so the
    // first ingest cycle only sees files modified after connect.
    const { connectGoogleFolderAction } = await import("./actions");

    await connectGoogleFolderAction(
      formDataFrom({
        scope: "company",
        company_id: "co_acme",
        folder_url: "https://drive.google.com/x",
      })
    );

    const patch = mocks.sourcesInsertPatch.mock.calls[0][0] as {
      cursor: string;
    };
    expect(patch.cursor).toBeTruthy();
    // ISO 8601 timestamp shape.
    expect(patch.cursor).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
  });

  it("translates SQLSTATE 23505 into 'already connected' rather than a raw duplicate error", async () => {
    mocks.sourcesInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const { connectGoogleFolderAction } = await import("./actions");

    const res = await connectGoogleFolderAction(
      formDataFrom({
        scope: "company",
        company_id: "co_acme",
        folder_url: "https://drive.google.com/x",
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/already connected/);
  });
});

// ==============================================================
// createAliasAction / deleteAliasAction
// ==============================================================
describe("createAliasAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects missing alias or company_id", async () => {
    const { createAliasAction } = await import("./actions");

    const res = await createAliasAction(
      formDataFrom({ company_id: "co_acme", alias: " " })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/alias/i);
    expect(mocks.aliasesInsert).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from registering an alias for another company", async () => {
    // company_id is a hidden field on the alias editor, which a
    // company_admin sees on their own company page. Editing it must
    // not let them plant aliases on (or siphon transcripts toward)
    // another tenant. The insert goes through the admin client, so
    // this check is the only thing standing in the way.
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    const { createAliasAction } = await import("./actions");

    const res = await createAliasAction(
      formDataFrom({ company_id: "co_other", alias: "Other Co" })
    );

    expect(res).toEqual({ ok: false, message: "Not your company." });
    expect(mocks.aliasesInsert).not.toHaveBeenCalled();
  });

  it("lets a company_admin register an alias for their own company", async () => {
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    const { createAliasAction } = await import("./actions");

    const res = await createAliasAction(
      formDataFrom({ company_id: "co_acme", alias: "Acme" })
    );

    expect(res).toEqual({ ok: true });
    expect(mocks.aliasesInsert).toHaveBeenCalledWith({
      company_id: "co_acme",
      alias: "Acme",
    });
  });

  it("translates SQLSTATE 23505 into the 'another company uses that alias' message", async () => {
    // A raw duplicate-key error would leak that ANOTHER company has
    // claimed the alias (which is what we want to communicate but
    // in friendly language, not a Postgres error).
    mocks.aliasesInsert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    const { createAliasAction } = await import("./actions");

    const res = await createAliasAction(
      formDataFrom({ company_id: "co_acme", alias: "Acme" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Another company already uses/);
  });
});

// ==============================================================
// routeMeetingAction / dismissMeetingAction
// ==============================================================
describe("routeMeetingAction + dismissMeetingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
    mocks.processPendingMeetings.mockResolvedValue({ processed: 1 });
  });

  it("routeMeeting sets company_id + status=pending + a (manual) alias tag", async () => {
    // The (manual) marker tells the recent-meetings table which rows
    // were operator-routed vs alias-matched. If a refactor drops the
    // tag, the audit trail loses that distinction.
    const { routeMeetingAction } = await import("./actions");

    await routeMeetingAction("meeting_1", "co_target", false);

    expect(mocks.meetingsUpdatePatch).toHaveBeenCalledWith({
      company_id: "co_target",
      status: "pending",
      routed_by_alias: "(manual)",
    });
    expect(mocks.processPendingMeetings).not.toHaveBeenCalled();
  });

  it("routeMeeting with analyzeNow=true immediately triggers processing for the routed meeting", async () => {
    const { routeMeetingAction } = await import("./actions");

    await routeMeetingAction("meeting_1", "co_target", true);

    expect(mocks.processPendingMeetings).toHaveBeenCalledWith({
      meetingId: "meeting_1",
    });
  });

  it("dismissMeeting marks the row failed with error='dismissed' — preserves the audit trail", async () => {
    // Contract: dismissing doesn't delete the row. The audit trail
    // (who dismissed what, when) is what makes routing rules
    // debuggable weeks later.
    const { dismissMeetingAction } = await import("./actions");

    await dismissMeetingAction("meeting_1");

    expect(mocks.meetingsUpdatePatch).toHaveBeenCalledWith({
      status: "failed",
      error: "dismissed",
    });
  });
});

// ==============================================================
// deleteAliasAction — tenant boundary
// ==============================================================
describe("deleteAliasAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks a company_admin from deleting another tenant's alias", async () => {
    // Deleting a victim's alias silently un-routes all their future
    // transcripts. The alias row names its company; the caller must
    // admin that company.
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    mocks.aliasesSelectMaybeSingle.mockResolvedValueOnce({
      data: { company_id: "co_other" },
      error: null,
    });
    const { deleteAliasAction } = await import("./actions");

    const res = await deleteAliasAction("alias_1");

    expect(res).toEqual({ ok: false, message: "Not your alias to manage." });
    expect(mocks.aliasesDeleteEq).not.toHaveBeenCalled();
  });

  it("returns not-found (and deletes nothing) for an unknown alias id", async () => {
    mocks.aliasesSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { deleteAliasAction } = await import("./actions");

    const res = await deleteAliasAction("alias_missing");

    expect(res).toEqual({ ok: false, message: "Alias not found." });
    expect(mocks.aliasesDeleteEq).not.toHaveBeenCalled();
  });

  it("lets a company_admin delete their own company's alias", async () => {
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    const { deleteAliasAction } = await import("./actions");

    const res = await deleteAliasAction("alias_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.aliasesDeleteEq).toHaveBeenCalledTimes(1);
  });
});

// ==============================================================
// routeMeetingAction / dismissMeetingAction — tenant boundary
// ==============================================================
describe("routeMeetingAction + dismissMeetingAction (tenant boundary)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
    mocks.processPendingMeetings.mockResolvedValue({ processed: 1 });
  });

  it("blocks a company_admin from routing ANOTHER tenant's meeting into their own company", async () => {
    // The original hole: the update ran through the admin client
    // with no check on whose meeting it was. Re-homing a victim's
    // meeting exposed its transcript to the attacker's whole team
    // and analyzed it into their commitments and issues.
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    mocks.meetingsSelectMaybeSingle.mockResolvedValueOnce({
      data: { company_id: "co_other" },
      error: null,
    });
    const { routeMeetingAction } = await import("./actions");

    const res = await routeMeetingAction("meeting_victim", "co_acme", true);

    expect(res).toEqual({ ok: false, message: "Not your meeting to manage." });
    expect(mocks.meetingsUpdatePatch).not.toHaveBeenCalled();
    expect(mocks.processPendingMeetings).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from routing an UNROUTED (shared-scope) meeting", async () => {
    // Unrouted meetings have no company yet. They came from a shared
    // folder that may hold other clients' transcripts, so only a
    // system_admin may decide where they go.
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    mocks.meetingsSelectMaybeSingle.mockResolvedValueOnce({
      data: { company_id: null },
      error: null,
    });
    const { routeMeetingAction } = await import("./actions");

    const res = await routeMeetingAction("meeting_unrouted", "co_acme", false);

    expect(res).toEqual({ ok: false, message: "Not your meeting to manage." });
    expect(mocks.meetingsUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from routing their OWN meeting into another tenant", async () => {
    // Reverse direction: injecting a transcript (and the commitments
    // extracted from it) into someone else's company.
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    mocks.meetingsSelectMaybeSingle.mockResolvedValueOnce({
      data: { company_id: "co_acme" },
      error: null,
    });
    const { routeMeetingAction } = await import("./actions");

    const res = await routeMeetingAction("meeting_mine", "co_other", false);

    expect(res).toEqual({ ok: false, message: "Not your company." });
    expect(mocks.meetingsUpdatePatch).not.toHaveBeenCalled();
  });

  it("lets a company_admin re-route a meeting that already belongs to their company", async () => {
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    mocks.meetingsSelectMaybeSingle.mockResolvedValueOnce({
      data: { company_id: "co_acme" },
      error: null,
    });
    const { routeMeetingAction } = await import("./actions");

    const res = await routeMeetingAction("meeting_mine", "co_acme", false);

    expect(res).toEqual({ ok: true });
    expect(mocks.meetingsUpdatePatch).toHaveBeenCalledWith({
      company_id: "co_acme",
      status: "pending",
      routed_by_alias: "(manual)",
    });
  });

  it("lets a system_admin route an unrouted meeting anywhere", async () => {
    const { routeMeetingAction } = await import("./actions");

    const res = await routeMeetingAction("meeting_unrouted", "co_target", false);

    expect(res).toEqual({ ok: true });
    expect(mocks.meetingsUpdatePatch).toHaveBeenCalledTimes(1);
  });

  it("returns not-found (and writes nothing) for an unknown meeting id", async () => {
    mocks.meetingsSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { routeMeetingAction } = await import("./actions");

    const res = await routeMeetingAction("meeting_missing", "co_target", false);

    expect(res).toEqual({ ok: false, message: "Meeting not found." });
    expect(mocks.meetingsUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from dismissing another tenant's meeting", async () => {
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    mocks.meetingsSelectMaybeSingle.mockResolvedValueOnce({
      data: { company_id: "co_other" },
      error: null,
    });
    const { dismissMeetingAction } = await import("./actions");

    const res = await dismissMeetingAction("meeting_victim");

    expect(res).toEqual({ ok: false, message: "Not your meeting to manage." });
    expect(mocks.meetingsUpdatePatch).not.toHaveBeenCalled();
  });

  it("lets a company_admin dismiss their own company's meeting", async () => {
    useRealCompanyAdminRule();
    companyAdminOf("co_acme");
    mocks.meetingsSelectMaybeSingle.mockResolvedValueOnce({
      data: { company_id: "co_acme" },
      error: null,
    });
    const { dismissMeetingAction } = await import("./actions");

    const res = await dismissMeetingAction("meeting_mine");

    expect(res).toEqual({ ok: true });
    expect(mocks.meetingsUpdatePatch).toHaveBeenCalledWith({
      status: "failed",
      error: "dismissed",
    });
  });
});
