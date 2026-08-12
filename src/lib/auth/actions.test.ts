import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/auth/actions.ts. Two contracts here
// are load-bearing:
//   1. requestPasswordResetAction NEVER returns "user not found" —
//      every failure path still resolves to { ok: true } so an
//      attacker can't probe the user list via reset attempts.
//   2. completeAcceptInviteAction runs verifyOtp → updateUser →
//      profiles.update(status='active'). Steps 1 and 2 running while
//      the profile stays 'pending' is the bug that stranded Jeff
//      Boumwan on 2026-08-08 — we test that the activation write
//      fires on success.

const REDIRECT_SIGNAL = "__redirect__";

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const signInWithPassword = vi.fn();
  const signOut = vi.fn();
  const verifyOtp = vi.fn();
  const updateUser = vi.fn();

  const generateLink = vi.fn();

  const profilesSelectMaybeSingle = vi.fn();
  const profilesUpdatePatch = vi.fn();
  const profilesUpdateEq = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: profilesSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          profilesUpdatePatch(patch);
          return { eq: profilesUpdateEq };
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = {
    auth: { signInWithPassword, signOut, verifyOtp, updateUser },
    from: fromBuilder,
  };
  const admin = {
    auth: { admin: { generateLink } },
    from: fromBuilder,
  };

  const clearScopedCompanyCookie = vi.fn();
  const sendResetEmail = vi.fn();
  const revalidatePath = vi.fn();
  const redirect = vi.fn((url: string) => {
    throw { [REDIRECT_SIGNAL]: true, url };
  });

  return {
    signInWithPassword,
    signOut,
    verifyOtp,
    updateUser,
    generateLink,
    profilesSelectMaybeSingle,
    profilesUpdatePatch,
    profilesUpdateEq,
    serverClient,
    admin,
    clearScopedCompanyCookie,
    sendResetEmail,
    revalidatePath,
    redirect,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

vi.mock("@/lib/supabase/env", () => ({
  APP_URL: () => "http://localhost:3200",
}));

vi.mock("@/lib/admin/scope", () => ({
  clearScopedCompanyCookie: mocks.clearScopedCompanyCookie,
}));

vi.mock("@/lib/email", () => ({
  sendResetEmail: mocks.sendResetEmail,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

// ---- Helpers --------------------------------------------------
function formDataFrom(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

function captureRedirect<T>(fn: () => Promise<T>): Promise<string> {
  return fn().then(
    () => {
      throw new Error("Expected a redirect");
    },
    (err: unknown) => {
      if (err && typeof err === "object" && REDIRECT_SIGNAL in err) {
        return (err as { url: string }).url;
      }
      throw err;
    }
  );
}

function primeHappyPath() {
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({
    data: { session: { user: { id: "user_1" } } },
    error: null,
  });
  mocks.updateUser.mockResolvedValue({
    data: { user: { id: "user_1" } },
    error: null,
  });
  mocks.generateLink.mockResolvedValue({
    data: {
      properties: { hashed_token: "tok_abc" },
      user: { id: "user_1" },
    },
    error: null,
  });
  mocks.profilesSelectMaybeSingle.mockResolvedValue({
    data: { first_name: "Ada" },
    error: null,
  });
  mocks.profilesUpdateEq.mockResolvedValue({ error: null });
  mocks.sendResetEmail.mockResolvedValue({ ok: true });
  mocks.redirect.mockImplementation((url: string) => {
    throw { [REDIRECT_SIGNAL]: true, url };
  });
}

// ==============================================================
// signInAction
// ==============================================================
describe("signInAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects missing email or password", async () => {
    const { signInAction } = await import("./actions");

    const res = await signInAction(
      undefined,
      formDataFrom({ email: "", password: "" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/email and password/);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("uses non-blaming copy on wrong credentials — never says 'that email doesn't exist'", async () => {
    // Contract: never disclose whether an email is registered.
    mocks.signInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid login credentials" },
    });
    const { signInAction } = await import("./actions");

    const res = await signInAction(
      undefined,
      formDataFrom({ email: "a@b.co", password: "x" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/didn't match/);
      expect(res.message).not.toMatch(/exist|register|found/i);
    }
  });

  it("clears the scope cookie and redirects on successful sign-in", async () => {
    // Fresh session shouldn't inherit a stale scope from a previous
    // sysadmin session. clearScopedCompanyCookie is a no-op for
    // regular users but MUST fire.
    const { signInAction } = await import("./actions");

    const target = await captureRedirect(() =>
      signInAction(
        undefined,
        formDataFrom({ email: "a@b.co", password: "hunter2" })
      )
    );

    expect(target).toBe("/");
    expect(mocks.clearScopedCompanyCookie).toHaveBeenCalledTimes(1);
  });
});

// ==============================================================
// signOutAction
// ==============================================================
describe("signOutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("signs out and redirects to /sign-in", async () => {
    const { signOutAction } = await import("./actions");

    const target = await captureRedirect(() => signOutAction());

    expect(target).toBe("/sign-in");
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
});

// ==============================================================
// requestPasswordResetAction — the "don't leak" contract
// ==============================================================
describe("requestPasswordResetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an empty email up front (before the leak-prevention branches)", async () => {
    const { requestPasswordResetAction } = await import("./actions");

    const res = await requestPasswordResetAction(
      undefined,
      formDataFrom({ email: "" })
    );

    expect(res).toEqual({
      ok: false,
      message: "Enter the email tied to your account.",
    });
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("returns { ok:true } when generateLink errors — never leaks 'user not found'", async () => {
    // Any generateLink failure resolves as ok:true so a probe can't
    // distinguish "invalid email," "unknown email," or "worked."
    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: { message: "User not found" },
    });
    const { requestPasswordResetAction } = await import("./actions");

    const res = await requestPasswordResetAction(
      undefined,
      formDataFrom({ email: "unknown@x.co" })
    );

    expect(res).toEqual({ ok: true });
    expect(mocks.sendResetEmail).not.toHaveBeenCalled();
  });

  it("returns { ok:true } when Supabase doesn't return a hashed_token", async () => {
    mocks.generateLink.mockResolvedValueOnce({
      data: { properties: {} },
      error: null,
    });
    const { requestPasswordResetAction } = await import("./actions");

    const res = await requestPasswordResetAction(
      undefined,
      formDataFrom({ email: "a@b.co" })
    );

    expect(res).toEqual({ ok: true });
    expect(mocks.sendResetEmail).not.toHaveBeenCalled();
  });

  it("builds a token-in-URL link that goes DIRECTLY to /reset-password (never /auth/callback)", async () => {
    // Contract: same "token-as-form-submit" pattern as the invite
    // flow. If a refactor pushes this through /auth/callback, link
    // previewers would burn the one-shot token before the real user.
    const { requestPasswordResetAction } = await import("./actions");

    await requestPasswordResetAction(undefined, formDataFrom({ email: "a@b.co" }));

    const args = mocks.sendResetEmail.mock.calls[0][0] as {
      actionLink: string;
    };
    expect(args.actionLink).toContain("/reset-password");
    expect(args.actionLink).toContain("token_hash=tok_abc");
    expect(args.actionLink).toContain("type=recovery");
    expect(args.actionLink).not.toContain("/auth/callback");
  });
});

// ==============================================================
// completeAcceptInviteAction — the "activate the profile" contract
// ==============================================================
describe("completeAcceptInviteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects a missing token (marks it expired)", async () => {
    const { completeAcceptInviteAction } = await import("./actions");

    const res = await completeAcceptInviteAction(
      undefined,
      formDataFrom({ token_hash: "", type: "invite", password: "hunter22", confirm: "hunter22" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/missing its invitation token/);
      expect(res.expired).toBe(true);
    }
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const { completeAcceptInviteAction } = await import("./actions");

    const res = await completeAcceptInviteAction(
      undefined,
      formDataFrom({
        token_hash: "tok",
        type: "invite",
        password: "short",
        confirm: "short",
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/8 characters/);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirm", async () => {
    const { completeAcceptInviteAction } = await import("./actions");

    const res = await completeAcceptInviteAction(
      undefined,
      formDataFrom({
        token_hash: "tok",
        type: "invite",
        password: "hunter22",
        confirm: "hunter23",
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/don't match/);
  });

  it("marks the link expired when verifyOtp fails", async () => {
    mocks.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "otp expired" },
    });
    const { completeAcceptInviteAction } = await import("./actions");

    const res = await completeAcceptInviteAction(
      undefined,
      formDataFrom({
        token_hash: "tok",
        type: "invite",
        password: "hunter22",
        confirm: "hunter22",
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.expired).toBe(true);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("verifies the OTP, sets the password, and flips profile status to active", async () => {
    // This is the regression pin for the 2026-08-08 Jeff Boumwan bug.
    // All three writes MUST land on the happy path.
    const { completeAcceptInviteAction } = await import("./actions");

    const res = await completeAcceptInviteAction(
      undefined,
      formDataFrom({
        token_hash: "tok",
        type: "invite",
        password: "hunter22",
        confirm: "hunter22",
      })
    );

    expect(res).toEqual({ ok: true });
    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "hunter22" });
    expect(mocks.profilesUpdatePatch).toHaveBeenCalledWith({ status: "active" });
  });

  it("still returns ok when the profile activation write fails (user IS signed in)", async () => {
    // Contract: verifyOtp + updateUser already succeeded, so the user
    // is authenticated and can sign in. The failing status flip logs
    // for triage but doesn't error the flow — otherwise a transient
    // DB blip would leave the user seeing "we couldn't finish" for
    // an account that's actually usable.
    mocks.profilesUpdateEq.mockResolvedValueOnce({
      error: { message: "network hiccup" },
    });
    const { completeAcceptInviteAction } = await import("./actions");

    const res = await completeAcceptInviteAction(
      undefined,
      formDataFrom({
        token_hash: "tok",
        type: "invite",
        password: "hunter22",
        confirm: "hunter22",
      })
    );

    expect(res).toEqual({ ok: true });
  });
});

// ==============================================================
// completeResetPasswordAction
// ==============================================================
describe("completeResetPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("does NOT touch profile.status (user is already active)", async () => {
    const { completeResetPasswordAction } = await import("./actions");

    const res = await completeResetPasswordAction(
      undefined,
      formDataFrom({
        token_hash: "tok",
        type: "recovery",
        password: "hunter22",
        confirm: "hunter22",
      })
    );

    expect(res).toEqual({ ok: true });
    expect(mocks.profilesUpdatePatch).not.toHaveBeenCalled();
  });
});

// ==============================================================
// setNewPasswordAction
// ==============================================================
describe("setNewPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const { setNewPasswordAction } = await import("./actions");

    const res = await setNewPasswordAction(
      undefined,
      formDataFrom({ password: "short", confirm: "short" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/8 characters/);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirm", async () => {
    const { setNewPasswordAction } = await import("./actions");

    const res = await setNewPasswordAction(
      undefined,
      formDataFrom({ password: "hunter22", confirm: "hunter23" })
    );

    expect(res.ok).toBe(false);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
