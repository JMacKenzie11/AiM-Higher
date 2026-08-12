import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/people/actions.ts. The two actions
// here share one subtlety: role handling on updateProfileAction. Self
// can NEVER change their own role — even if the client posts a role
// field. Admins can change others' roles subject to the "company_admin
// can't grant system_admin/aims_guide" rule (mirrors
// profiles_update_company_admin RLS in migration 0053).

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  // profiles chain shape here: .update({...}).eq(...).select("*").single()
  const profilesUpdatePatch = vi.fn();
  const profilesUpdateSingle = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "profiles") {
      return {
        update: (patch: unknown) => {
          profilesUpdatePatch(patch);
          return {
            eq: () => ({
              select: () => ({ single: profilesUpdateSingle }),
            }),
          };
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireProfile = vi.fn();
  const requireRole = vi.fn();
  const revalidatePath = vi.fn();

  return {
    profilesUpdatePatch,
    profilesUpdateSingle,
    serverClient,
    requireProfile,
    requireRole,
    revalidatePath,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
  requireRole: mocks.requireRole,
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

function sessionFor(profile: {
  id?: string;
  role?: "system_admin" | "company_admin" | "team_member" | "aims_guide";
  company_id?: string | null;
}) {
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
  mocks.profilesUpdateSingle.mockResolvedValue({
    data: {
      id: "profile_1",
      full_name: "Updated Name",
      position: "Estimator",
      role: "team_member",
      status: "active",
      company_id: "co_acme",
    },
    error: null,
  });
}

// ==============================================================
// updateProfileAction
// ==============================================================
describe("updateProfileAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects a missing profile id up front", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { updateProfileAction } = await import("./actions");

    const res = await updateProfileAction(undefined, formDataFrom({ id: "" }));

    expect(res).toEqual({ ok: false, message: "Missing profile id." });
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { updateProfileAction } = await import("./actions");

    const res = await updateProfileAction(
      undefined,
      formDataFrom({ id: "caller_1", full_name: "   " })
    );

    expect(res).toEqual({ ok: false, message: "Name is required." });
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a non-admin from editing someone else's profile", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "caller_1", role: "team_member" })
    );
    const { updateProfileAction } = await import("./actions");

    const res = await updateProfileAction(
      undefined,
      formDataFrom({ id: "someone_else", full_name: "Injected Name" })
    );

    expect(res).toEqual({ ok: false, message: "You can't edit that profile." });
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("preserves the caller's role on self-edit even when a role field is posted", async () => {
    // Self can never change own role — the client-posted role must be
    // ignored and the current session role written back instead. This
    // mirrors profiles_update_self RLS.
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "caller_1", role: "team_member" })
    );
    const { updateProfileAction } = await import("./actions");

    await updateProfileAction(
      undefined,
      formDataFrom({
        id: "caller_1",
        full_name: "Me",
        role: "system_admin", // attempted privilege escalation
      })
    );

    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ role: "team_member" })
    );
  });

  it("blocks a company_admin from granting system_admin (or any non-member/non-admin role)", async () => {
    // Matches profiles_update_company_admin RLS: company_admin can
    // only set role to team_member or company_admin on their tenants.
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "admin_1", role: "company_admin", company_id: "co_acme" })
    );
    const { updateProfileAction } = await import("./actions");

    const res = await updateProfileAction(
      undefined,
      formDataFrom({
        id: "someone_else",
        full_name: "Target",
        role: "system_admin",
      })
    );

    expect(res).toEqual({
      ok: false,
      message: "Company admins can't grant that role.",
    });
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("lets a company_admin grant team_member and company_admin roles", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "admin_1", role: "company_admin", company_id: "co_acme" })
    );
    const { updateProfileAction } = await import("./actions");

    await updateProfileAction(
      undefined,
      formDataFrom({
        id: "someone_else",
        full_name: "Target",
        role: "company_admin",
      })
    );

    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ role: "company_admin" })
    );
  });

  it("system_admin can grant any valid role", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "root", role: "system_admin" })
    );
    const { updateProfileAction } = await import("./actions");

    await updateProfileAction(
      undefined,
      formDataFrom({
        id: "someone_else",
        full_name: "Target",
        role: "system_admin",
      })
    );

    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ role: "system_admin" })
    );
  });

  it("defaults an unknown submitted role to team_member on admin edit", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "root", role: "system_admin" })
    );
    const { updateProfileAction } = await import("./actions");

    await updateProfileAction(
      undefined,
      formDataFrom({
        id: "someone_else",
        full_name: "Target",
        role: "totally-made-up-role",
      })
    );

    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ role: "team_member" })
    );
  });

  it("returns the updated profile on the happy path", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    const { updateProfileAction } = await import("./actions");

    const res = await updateProfileAction(
      undefined,
      formDataFrom({
        id: "caller_1",
        full_name: "Updated Name",
        position: "Estimator",
      })
    );

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.profile.full_name).toBe("Updated Name");
  });

  it("surfaces a friendly error when the DB update fails", async () => {
    mocks.requireProfile.mockResolvedValue(sessionFor({ id: "caller_1" }));
    mocks.profilesUpdateSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "violates check constraint" },
    });
    const { updateProfileAction } = await import("./actions");

    const res = await updateProfileAction(
      undefined,
      formDataFrom({ id: "caller_1", full_name: "Me" })
    );

    expect(res).toEqual({ ok: false, message: "Couldn't save that profile." });
  });
});

// ==============================================================
// setProfileStatusAction
// ==============================================================
describe("setProfileStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("writes the requested status via profiles.update", async () => {
    mocks.requireRole.mockResolvedValue(
      sessionFor({ role: "company_admin" })
    );
    const { setProfileStatusAction } = await import("./actions");

    const res = await setProfileStatusAction("person_1", "inactive");

    expect(res.ok).toBe(true);
    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith({
      status: "inactive",
    });
  });

  it("surfaces a friendly error when the DB update fails", async () => {
    mocks.requireRole.mockResolvedValue(
      sessionFor({ role: "company_admin" })
    );
    mocks.profilesUpdateSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "row-level security violation" },
    });
    const { setProfileStatusAction } = await import("./actions");

    const res = await setProfileStatusAction("person_1", "active");

    expect(res).toEqual({
      ok: false,
      message: "Couldn't update that person's status.",
    });
  });
});
