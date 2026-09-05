import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/auth/users.ts. Each action here has
// documented rollback / scope-guard / warning contracts (some of which
// were only added after a real incident — the silent-vanished invite
// on 2026-08-06, for example). These tests pin those contracts by
// stubbing supabase-admin, the server client, email, and next/cache
// so the branching is exercised without any network.
//
// Pattern for adding more action tests:
//   1. Reset every spy in beforeEach so a test's mock configuration
//      doesn't leak into the next.
//   2. Configure per-test overrides via mockResolvedValueOnce /
//      mockImplementationOnce; don't reach into the module's shape.
//   3. Import the action lazily (`await import("./users")`) so vi.mock
//      has already patched the dependency graph.
//   4. If a new table shows up, extend `fromBuilder` — don't inline
//      chain-mocks in tests, they're unreadable at scale.

// ---- Shared spies + fakes -------------------------------------
// vi.hoisted() runs before every module import — including the mocked
// ones — so we can reference these bindings inside vi.mock factories
// without a temporal-dead-zone error.
const mocks = vi.hoisted(() => {
  // Auth-admin surface. Every method is a spy so tests can assert
  // call args (deleteUser must fire on profile-insert failure, etc.).
  const createUser = vi.fn();
  const deleteUser = vi.fn();
  const generateLink = vi.fn();
  const getUserById = vi.fn();
  const updateUserById = vi.fn();
  const listUsers = vi.fn();

  // Server-client's auth.getUser (acceptInviteAction reads it).
  const serverGetUser = vi.fn();

  // profiles chainables. select().eq().maybeSingle() is used a lot,
  // update({...}).eq() is used a lot. Each terminal spy is exposed
  // so tests can prime it per-scenario.
  const profilesInsert = vi.fn();
  const profilesSelectMaybeSingle = vi.fn();
  const profilesUpdateEq = vi.fn();
  const profilesUpdatePatch = vi.fn();

  // user_strengths is only ever inserted into from this module (and
  // we now assert it never is — regression pin).
  const strengthsInsert = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "profiles") {
      return {
        insert: profilesInsert,
        select: () => ({
          eq: () => ({ maybeSingle: profilesSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          profilesUpdatePatch(patch);
          return { eq: profilesUpdateEq };
        },
      };
    }
    if (table === "user_strengths") {
      return { insert: strengthsInsert };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const admin = {
    auth: {
      admin: {
        createUser,
        deleteUser,
        generateLink,
        getUserById,
        updateUserById,
        listUsers,
      },
    },
    from: fromBuilder,
  };

  const serverClient = {
    auth: { getUser: serverGetUser },
    from: fromBuilder,
  };

  const requireRole = vi.fn();
  const sendInviteEmail = vi.fn();
  const revalidatePath = vi.fn();

  return {
    // spies
    createUser,
    deleteUser,
    generateLink,
    getUserById,
    updateUserById,
    listUsers,
    serverGetUser,
    profilesInsert,
    profilesSelectMaybeSingle,
    profilesUpdateEq,
    profilesUpdatePatch,
    strengthsInsert,
    requireRole,
    sendInviteEmail,
    revalidatePath,
    // clients
    admin,
    serverClient,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("@/lib/email", () => ({
  sendInviteEmail: mocks.sendInviteEmail,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// The whole module, not just APP_URL: getCurrentInstanceConfig reads
// the three Supabase getters to build the InstanceConfig that every
// client factory now takes.
vi.mock("@/lib/supabase/env", () => ({
  APP_URL: () => "http://localhost:3200",
  SUPABASE_URL: () => "https://test.invalid",
  SUPABASE_ANON_KEY: () => "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: () => "test-service-role-key",
}));

// ---- Helpers --------------------------------------------------
function formDataFrom(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else {
      fd.set(key, value);
    }
  }
  return fd;
}

function companyAdminSession(companyId = "co_acme") {
  return {
    profile: { id: "admin_1", role: "company_admin", company_id: companyId },
  };
}

function sysAdminSession() {
  return { profile: { id: "root", role: "system_admin", company_id: null } };
}

// Default happy-path responses. Individual tests override the pieces
// they care about via mockResolvedValueOnce / mockImplementationOnce.
function primeHappyPath() {
  mocks.createUser.mockResolvedValue({
    data: { user: { id: "user_new" } },
    error: null,
  });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.updateUserById.mockResolvedValue({ error: null });
  mocks.getUserById.mockResolvedValue({
    data: { user: { email: "existing@acme.co" } },
    error: null,
  });
  mocks.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "tok_abc" } },
    error: null,
  });
  mocks.listUsers.mockResolvedValue({ data: { users: [] } });

  mocks.profilesInsert.mockResolvedValue({ error: null });
  mocks.strengthsInsert.mockResolvedValue({ error: null });
  // Default: a benign profile row so most reads succeed. Tests that
  // care about a specific row shape override with mockResolvedValueOnce.
  mocks.profilesSelectMaybeSingle.mockResolvedValue({
    data: {
      id: "profile_1",
      company_id: "co_acme",
      status: "pending",
      first_name: "New",
      invited_at: null,
    },
    error: null,
  });
  mocks.profilesUpdateEq.mockResolvedValue({ error: null });

  mocks.sendInviteEmail.mockResolvedValue({ ok: true });
  mocks.serverGetUser.mockResolvedValue({ data: { user: { id: "user_new" } } });
}

// ==============================================================
// createUserAction
// ==============================================================
describe("createUserAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects when name or email is missing", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    const { createUserAction } = await import("./users");

    const res = await createUserAction(
      undefined,
      formDataFrom({ email: "", full_name: "" })
    );

    expect(res).toEqual({
      ok: false,
      message: "Name and email are required.",
    });
    // Guard: nothing was created when validation failed early.
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.profilesInsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown role", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    const { createUserAction } = await import("./users");

    const res = await createUserAction(
      undefined,
      formDataFrom({
        email: "new@acme.co",
        full_name: "New Person",
        role: "system_admin",
      })
    );

    expect(res).toEqual({ ok: false, message: "Choose a valid role." });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("uses the caller's company_id and ignores the form field for company_admin", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    const { createUserAction } = await import("./users");

    await createUserAction(
      undefined,
      formDataFrom({
        email: "new@acme.co",
        full_name: "New Person",
        // Attempted cross-company insert — must be ignored.
        company_id: "co_evil",
      })
    );

    expect(mocks.profilesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ company_id: "co_acme" })
    );
  });

  it("uses the form company_id for system_admin", async () => {
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { createUserAction } = await import("./users");

    await createUserAction(
      undefined,
      formDataFrom({
        email: "new@acme.co",
        full_name: "New Person",
        company_id: "co_target",
      })
    );

    expect(mocks.profilesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ company_id: "co_target" })
    );
  });

  it("returns the friendly duplicate-email message when Supabase says the user exists", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    mocks.createUser.mockResolvedValueOnce({
      data: null,
      error: { message: "User already been registered" },
    });
    const { createUserAction } = await import("./users");

    const res = await createUserAction(
      undefined,
      formDataFrom({ email: "dup@acme.co", full_name: "Dup Person" })
    );

    expect(res).toEqual({
      ok: false,
      message: "A user with that email already exists.",
    });
  });

  it("rolls back the auth user when the profile insert fails", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    mocks.profilesInsert.mockResolvedValueOnce({
      error: { message: "duplicate profile" },
    });
    const { createUserAction } = await import("./users");

    const res = await createUserAction(
      undefined,
      formDataFrom({ email: "new@acme.co", full_name: "New Person" })
    );

    expect(res.ok).toBe(false);
    // Rollback contract: leaking an orphan auth user is the exact
    // silent-failure this cleanup was added to prevent.
    expect(mocks.deleteUser).toHaveBeenCalledWith("user_new");
  });

  it("does NOT touch user_strengths (strengths are set later on the profile)", async () => {
    // Regression pin: strengths + superpowers used to be captured on
    // the add-person form and written here. That was removed — this
    // test fails loudly if a future change adds them back to the
    // create path instead of the profile-edit path.
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    const { createUserAction } = await import("./users");

    await createUserAction(
      undefined,
      formDataFrom({
        email: "new@acme.co",
        full_name: "New Person",
        // Even if a stray client posts these fields, they must not
        // reach the DB from this action.
        strength_label: ["Strategic thinking"],
        superpower_label: ["Reading a room"],
      })
    );

    expect(mocks.strengthsInsert).not.toHaveBeenCalled();
  });

  it("does not dispatch an invite when send_invite_now is off", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    const { createUserAction } = await import("./users");

    const res = await createUserAction(
      undefined,
      formDataFrom({ email: "new@acme.co", full_name: "New Person" })
    );

    expect(res).toEqual({ ok: true, profileId: "user_new", warning: undefined });
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("dispatches an invite and returns ok:true with no warning on success", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    const { createUserAction } = await import("./users");

    const res = await createUserAction(
      undefined,
      formDataFrom({
        email: "new@acme.co",
        full_name: "New Person",
        send_invite_now: "on",
      })
    );

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warning).toBeUndefined();
    expect(mocks.sendInviteEmail).toHaveBeenCalledTimes(1);
  });

  it("surfaces a warning (not an error) when the invite send fails", async () => {
    // The user IS in the system — we don't want the whole create to
    // roll back just because the email dispatcher hiccuped. The
    // create returns ok:true with a warning so the admin can hit
    // Resend from the roster row.
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: { message: "rate limited" },
    });
    const { createUserAction } = await import("./users");

    const res = await createUserAction(
      undefined,
      formDataFrom({
        email: "new@acme.co",
        full_name: "New Person",
        send_invite_now: "on",
      })
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warning).toMatch(/invite email didn't send/);
      expect(res.warning).toMatch(/rate limited/);
    }
  });
});

// ==============================================================
// updateUserAction
// ==============================================================
describe("updateUserAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  function baseForm(overrides: Record<string, string> = {}): FormData {
    return formDataFrom({
      id: "profile_1",
      first_name: "First",
      last_name: "Last",
      email: "existing@acme.co",
      role: "team_member",
      ...overrides,
    });
  }

  it("rejects a missing profile id up front", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(undefined, formDataFrom({ id: "" }));

    expect(res).toEqual({ ok: false, message: "Missing user id." });
    expect(mocks.profilesSelectMaybeSingle).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from granting system_admin or aims_guide", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(
      undefined,
      baseForm({ role: "system_admin" })
    );

    expect(res).toEqual({
      ok: false,
      message: "Company admins can't grant that role.",
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from editing a user in another company", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_other" },
      error: null,
    });
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(undefined, baseForm());

    expect(res).toEqual({ ok: false, message: "Not your user to edit." });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("skips updateUserById when the email is unchanged", async () => {
    // No-op email updates trigger Supabase's magic-link confirmation
    // flow — sending a "confirm your new address" email for an address
    // that didn't actually change is a real user-visible bug.
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    mocks.getUserById.mockResolvedValueOnce({
      data: { user: { email: "same@acme.co" } },
      error: null,
    });
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(
      undefined,
      baseForm({ email: "same@acme.co" })
    );

    expect(res.ok).toBe(true);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.profilesUpdatePatch).toHaveBeenCalledTimes(1);
  });

  it("returns the friendly duplicate-email message when the new email is taken", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    mocks.getUserById.mockResolvedValueOnce({
      data: { user: { email: "old@acme.co" } },
      error: null,
    });
    mocks.updateUserById.mockResolvedValueOnce({
      error: { message: "Email already exists" },
    });
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(
      undefined,
      baseForm({ email: "taken@acme.co" })
    );

    expect(res).toEqual({
      ok: false,
      message: "That email is already in use.",
    });
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("normalises the email to lowercase before comparing / writing", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    mocks.getUserById.mockResolvedValueOnce({
      data: { user: { email: "user@acme.co" } },
      error: null,
    });
    const { updateUserAction } = await import("./users");

    // Same address, different case — must be treated as no-change so
    // no confirmation email fires.
    await updateUserAction(undefined, baseForm({ email: "USER@Acme.co" }));

    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});

// ==============================================================
// dispatchInvite
// ==============================================================
describe("dispatchInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("returns a link-error message when generateLink fails", async () => {
    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: { message: "rate limited" },
    });
    const { dispatchInvite } = await import("./users");

    const res = await dispatchInvite("profile_1", "new@acme.co");

    expect(res).toEqual({
      ok: false,
      message: "Couldn't generate a sign-in link: rate limited",
    });
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
    // Must NOT bump invited_at when nothing went out — otherwise the
    // roster shows "Sent" for a link that was never delivered.
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("errors when Supabase returned no hashed_token", async () => {
    mocks.generateLink.mockResolvedValueOnce({
      data: { properties: {} },
      error: null,
    });
    const { dispatchInvite } = await import("./users");

    const res = await dispatchInvite("profile_1", "new@acme.co");

    expect(res.ok).toBe(false);
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("returns a distinct message when the link is generated but email dispatch fails", async () => {
    // This is the surface where the silent-vanished-invite class bug
    // lives: link exists, email didn't send. The message must call out
    // both facts so an admin can hand the link over manually.
    mocks.sendInviteEmail.mockResolvedValueOnce({
      ok: false,
      message: "smtp down",
    });
    const { dispatchInvite } = await import("./users");

    const res = await dispatchInvite("profile_1", "new@acme.co");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/Generated a sign-in link/);
      expect(res.message).toMatch(/smtp down/);
    }
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("stamps invited_at on success", async () => {
    const { dispatchInvite } = await import("./users");

    const res = await dispatchInvite("profile_1", "new@acme.co");

    expect(res).toEqual({ ok: true, profileId: "profile_1" });
    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ invited_at: expect.any(String) })
    );
  });

  it("builds the /accept-invite link with the hashed token, not the Supabase action_link", async () => {
    // Contract: the emailed link goes directly to /accept-invite with
    // ?token_hash=…&type=magiclink — never via Supabase's /auth/v1/verify.
    // If a refactor accidentally starts using data.properties.action_link,
    // link-previewer scanners would burn the one-shot token before the
    // real user could click it.
    const { dispatchInvite } = await import("./users");

    await dispatchInvite("profile_1", "new@acme.co");

    const call = mocks.sendInviteEmail.mock.calls[0][0] as {
      actionLink: string;
    };
    expect(call.actionLink).toContain("/accept-invite");
    expect(call.actionLink).toContain("token_hash=tok_abc");
    expect(call.actionLink).toContain("type=magiclink");
    expect(call.actionLink).not.toContain("/auth/v1/verify");
  });
});

// ==============================================================
// sendInviteAction
// ==============================================================
describe("sendInviteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks a company_admin from sending to another company's user", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_other", status: "pending" },
      error: null,
    });
    const { sendInviteAction } = await import("./users");

    const res = await sendInviteAction("profile_1");

    expect(res).toEqual({ ok: false, message: "Not your user to invite." });
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("refuses to invite an already-active user", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_acme", status: "active" },
      error: null,
    });
    const { sendInviteAction } = await import("./users");

    const res = await sendInviteAction("profile_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/already active/);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("refuses to invite an inactive user (must be reactivated first)", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_acme", status: "inactive" },
      error: null,
    });
    const { sendInviteAction } = await import("./users");

    const res = await sendInviteAction("profile_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/deactivated/);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("dispatches on a pending user in the caller's own company", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_acme", status: "pending" },
      error: null,
    });
    const { sendInviteAction } = await import("./users");

    const res = await sendInviteAction("profile_1");

    expect(res).toEqual({ ok: true, profileId: "profile_1" });
    expect(mocks.sendInviteEmail).toHaveBeenCalledTimes(1);
  });
});

// ==============================================================
// getInviteLinkAction
// ==============================================================
describe("getInviteLinkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("returns the token-in-URL link on success and stamps invited_at", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_acme", status: "pending" },
      error: null,
    });
    const { getInviteLinkAction } = await import("./users");

    const res = await getInviteLinkAction("profile_1");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.link).toContain("/accept-invite");
      expect(res.link).toContain("token_hash=tok_abc");
      expect(res.link).toContain("type=magiclink");
    }
    // The copy-link path is a delivery — the roster should reflect
    // that a link is out (same as the email path).
    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ invited_at: expect.any(String) })
    );
    // But we did NOT try to email — copy-link is admin-hands-it-over.
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("scope-blocks a company_admin from generating a link for another company", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_other", status: "pending" },
      error: null,
    });
    const { getInviteLinkAction } = await import("./users");

    const res = await getInviteLinkAction("profile_1");

    expect(res.ok).toBe(false);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });
});

// ==============================================================
// requestFreshInviteAction — the "don't leak existence" contract
// ==============================================================
describe("requestFreshInviteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("always returns {ok:true} for a garbage email — no info leak", async () => {
    const { requestFreshInviteAction } = await import("./users");

    const res = await requestFreshInviteAction("not-an-email");

    expect(res).toEqual({ ok: true });
    // Also, no lookups should have fired for the malformed address.
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(mocks.profilesSelectMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("returns {ok:true} but does NOT dispatch when the user is already active", async () => {
    // Active users must never trigger a fresh magic-link from this
    // public endpoint — otherwise anyone could spam a known user's
    // inbox with sign-in prompts.
    mocks.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: "user_1", email: "active@acme.co" }] },
    });
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "user_1", status: "active", invited_at: null },
      error: null,
    });
    const { requestFreshInviteAction } = await import("./users");

    const res = await requestFreshInviteAction("active@acme.co");

    expect(res).toEqual({ ok: true });
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("respects the 60-second cooldown so a hammering client can't spam Resend", async () => {
    mocks.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: "user_1", email: "pending@acme.co" }] },
    });
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "user_1",
        status: "pending",
        // 10s ago — well inside the 60s cooldown.
        invited_at: new Date(Date.now() - 10_000).toISOString(),
      },
      error: null,
    });
    const { requestFreshInviteAction } = await import("./users");

    const res = await requestFreshInviteAction("pending@acme.co");

    expect(res).toEqual({ ok: true });
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("dispatches when the user is pending and past the cooldown", async () => {
    mocks.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: "user_1", email: "pending@acme.co" }] },
    });
    mocks.profilesSelectMaybeSingle
      // First read: requestFreshInviteAction's own status/invited_at fetch.
      .mockResolvedValueOnce({
        data: {
          id: "user_1",
          status: "pending",
          invited_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        },
        error: null,
      })
      // Second read: dispatchInvite's first_name fetch. Falls back to
      // the primed default, but explicit is friendlier for future
      // readers looking at this test.
      .mockResolvedValueOnce({
        data: { first_name: "Pending" },
        error: null,
      });
    const { requestFreshInviteAction } = await import("./users");

    const res = await requestFreshInviteAction("pending@acme.co");

    expect(res).toEqual({ ok: true });
    expect(mocks.sendInviteEmail).toHaveBeenCalledTimes(1);
  });
});

// ==============================================================
// deleteUserAction
// ==============================================================
describe("deleteUserAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("refuses to let a caller delete themselves", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession());
    const { deleteUserAction } = await import("./users");

    // companyAdminSession().profile.id === "admin_1"
    const res = await deleteUserAction("admin_1");

    expect(res).toEqual({
      ok: false,
      message: "You can't delete your own account.",
    });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from deleting a user in another company", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_other" },
      error: null,
    });
    const { deleteUserAction } = await import("./users");

    const res = await deleteUserAction("profile_1");

    expect(res).toEqual({ ok: false, message: "Not your user to delete." });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("calls admin.auth.admin.deleteUser on a same-company target", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_acme" },
      error: null,
    });
    const { deleteUserAction } = await import("./users");

    const res = await deleteUserAction("profile_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.deleteUser).toHaveBeenCalledWith("profile_1");
  });
});

// ==============================================================
// acceptInviteAction
// ==============================================================
describe("acceptInviteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when there's no signed-in user in the request", async () => {
    mocks.serverGetUser.mockResolvedValueOnce({ data: { user: null } });
    const { acceptInviteAction } = await import("./users");

    const res = await acceptInviteAction();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Sign in first/);
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("errors when the signed-in auth user has no profile row", async () => {
    mocks.serverGetUser.mockResolvedValueOnce({
      data: { user: { id: "orphan_auth" } },
    });
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { acceptInviteAction } = await import("./users");

    const res = await acceptInviteAction();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/couldn't find your account/i);
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("is idempotent — no write when the profile is already active", async () => {
    mocks.serverGetUser.mockResolvedValueOnce({
      data: { user: { id: "user_1" } },
    });
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "user_1", status: "active" },
      error: null,
    });
    const { acceptInviteAction } = await import("./users");

    const res = await acceptInviteAction();

    expect(res).toEqual({ ok: true });
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("flips a pending profile to active", async () => {
    mocks.serverGetUser.mockResolvedValueOnce({
      data: { user: { id: "user_1" } },
    });
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "user_1", status: "pending" },
      error: null,
    });
    const { acceptInviteAction } = await import("./users");

    const res = await acceptInviteAction();

    expect(res).toEqual({ ok: true });
    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith({ status: "active" });
  });
});

// ==============================================================
// aims_guide scope — every roster action must scope guides the
// same way it scopes company admins (assigned companies only).
// Before canManageProfileIn, the company check only ran for
// company_admin, so a guide could edit ANY profile on the
// platform through the admin client, including granting
// themselves system_admin.
// ==============================================================
function guideSession(assigned: string[] = ["co_acme"]) {
  return {
    profile: {
      id: "guide_1",
      role: "aims_guide",
      company_id: null,
      guide_company_ids: assigned,
    },
  };
}

function editForm(overrides: Record<string, string> = {}): FormData {
  return formDataFrom({
    id: "profile_1",
    first_name: "First",
    last_name: "Last",
    email: "existing@acme.co",
    role: "team_member",
    ...overrides,
  });
}

describe("updateUserAction (aims_guide + reports_to scope)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks an aims_guide from editing a user in a company they aren't assigned to", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_other" },
      error: null,
    });
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(undefined, editForm());

    expect(res).toEqual({ ok: false, message: "Not your user to edit." });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks an aims_guide from editing a company-less profile (sysadmins, other guides, themselves)", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "guide_1", company_id: null },
      error: null,
    });
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(
      undefined,
      editForm({ id: "guide_1", role: "team_member" })
    );

    expect(res).toEqual({ ok: false, message: "Not your user to edit." });
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks an aims_guide from granting system_admin or aims_guide", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(
      undefined,
      editForm({ role: "system_admin" })
    );

    expect(res).toEqual({ ok: false, message: "Guides can't grant that role." });
    expect(mocks.profilesSelectMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("lets an aims_guide edit a user in an assigned company", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_acme" },
      error: null,
    });
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(undefined, editForm());

    expect(res).toEqual({ ok: true, profileId: "profile_1" });
    expect(mocks.profilesUpdatePatch).toHaveBeenCalledTimes(1);
  });

  it("rejects a reports_to manager who lives in a different company", async () => {
    // A cross-company manager makes an outsider satisfy "reports to
    // me" checks elsewhere (coach access on the report, for one).
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    mocks.profilesSelectMaybeSingle
      .mockResolvedValueOnce({
        data: { id: "profile_1", company_id: "co_acme" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "mgr_other", company_id: "co_other" },
        error: null,
      });
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(
      undefined,
      editForm({ reports_to: "mgr_other" })
    );

    expect(res).toEqual({
      ok: false,
      message: "The manager must be in the same company.",
    });
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("rejects a reports_to id that doesn't resolve to any profile", async () => {
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    mocks.profilesSelectMaybeSingle
      .mockResolvedValueOnce({
        data: { id: "profile_1", company_id: "co_acme" },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(
      undefined,
      editForm({ reports_to: "mgr_missing" })
    );

    expect(res.ok).toBe(false);
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });

  it("accepts a same-company manager and writes reports_to", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    mocks.profilesSelectMaybeSingle
      .mockResolvedValueOnce({
        data: { id: "profile_1", company_id: "co_acme" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "mgr_same", company_id: "co_acme" },
        error: null,
      });
    const { updateUserAction } = await import("./users");

    const res = await updateUserAction(
      undefined,
      editForm({ reports_to: "mgr_same" })
    );

    expect(res).toEqual({ ok: true, profileId: "profile_1" });
    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ reports_to: "mgr_same" })
    );
  });
});

describe("createUserAction (aims_guide scope)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("lets an aims_guide create a user in an assigned company via the form company_id", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    const { createUserAction } = await import("./users");

    const res = await createUserAction(
      undefined,
      formDataFrom({
        email: "new@acme.co",
        full_name: "New Person",
        role: "team_member",
        company_id: "co_acme",
      })
    );

    expect(res.ok).toBe(true);
    expect(mocks.profilesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ company_id: "co_acme" })
    );
  });

  it("blocks an aims_guide from creating a user in a company they aren't assigned to", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    const { createUserAction } = await import("./users");

    const res = await createUserAction(
      undefined,
      formDataFrom({
        email: "new@other.co",
        full_name: "New Person",
        role: "team_member",
        company_id: "co_other",
      })
    );

    expect(res).toEqual({ ok: false, message: "Not your company." });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.profilesInsert).not.toHaveBeenCalled();
  });
});

describe("sendInviteAction / getInviteLinkAction / deleteUserAction (aims_guide scope)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks an aims_guide from inviting a user outside their assignments", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_other", status: "pending" },
      error: null,
    });
    const { sendInviteAction } = await import("./users");

    const res = await sendInviteAction("profile_1");

    expect(res).toEqual({ ok: false, message: "Not your user to invite." });
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("blocks an aims_guide from generating an invite link outside their assignments", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_other", status: "pending" },
      error: null,
    });
    const { getInviteLinkAction } = await import("./users");

    const res = await getInviteLinkAction("profile_1");

    expect(res).toEqual({ ok: false, message: "Not your user to invite." });
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("blocks an aims_guide from deleting a user outside their assignments", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_other" },
      error: null,
    });
    const { deleteUserAction } = await import("./users");

    const res = await deleteUserAction("profile_1");

    expect(res).toEqual({ ok: false, message: "Not your user to delete." });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from deleting a company-less profile (a sysadmin or guide)", async () => {
    mocks.requireRole.mockResolvedValue(companyAdminSession("co_acme"));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "root", company_id: null },
      error: null,
    });
    const { deleteUserAction } = await import("./users");

    const res = await deleteUserAction("root");

    expect(res).toEqual({ ok: false, message: "Not your user to delete." });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("lets an aims_guide delete a user in an assigned company", async () => {
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "profile_1", company_id: "co_acme" },
      error: null,
    });
    const { deleteUserAction } = await import("./users");

    const res = await deleteUserAction("profile_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.deleteUser).toHaveBeenCalledWith("profile_1");
  });
});
