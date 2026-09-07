import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@/lib/types";

// Creating a user who has not signed in yet, and the link that lets
// them set a password.
//
// Extracted from users.ts so the provisioning CLI can create a new
// instance's first admin through the same code rather than a second
// implementation. The action keeps what only it can do —
// authorization, scoping a company_admin to their own company, the
// invite-sent tracking — and calls these for the rest.
//
// Both take the admin client and the app URL as arguments. In the app
// those come from the current request's instance; in provisioning they
// point at the instance being built, which is a different database and
// a different hostname. That parameterisation is the whole reason
// these are separate: dispatchInvite read both from module-level
// helpers tied to "the current request", so calling it from a script
// would have generated a link to the wrong host against the wrong
// database — silently, and only discovered by whoever clicked it.

export type PendingUserResult =
  | { ok: true; profileId: string }
  | { ok: false; message: string };

// Creates the auth user and its pending profile row.
//
// email_confirm is deliberately false: the account is not usable until
// the person follows their link and sets a password, and status
// 'pending' is what the middleware check keys off to keep them out of
// the app until they do.
export async function createPendingUser(input: {
  admin: SupabaseClient;
  email: string;
  fullName: string;
  role: Role;
  // null for a system_admin, who belongs to no company.
  companyId: string | null;
  position?: string | null;
}): Promise<PendingUserResult> {
  const { admin } = input;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: input.email,
    email_confirm: false,
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "";
    if (/already been registered|already exists/i.test(msg)) {
      return { ok: false, message: "A user with that email already exists." };
    }
    return { ok: false, message: "Couldn't create that user." };
  }

  const userId = created.user.id;

  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId,
    company_id: input.companyId,
    full_name: input.fullName,
    position: input.position ?? null,
    role: input.role,
    status: "pending",
  });

  if (profileErr) {
    // Best-effort cleanup — otherwise an orphan auth user is left
    // behind that nothing in the app can see or remove, and the email
    // can never be used again.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { ok: false, message: "Couldn't create that user's profile." };
  }

  return { ok: true, profileId: userId };
}

export type AcceptLinkResult =
  | { ok: true; link: string }
  | { ok: false; message: string };

// Builds the link that lets someone set their first password.
//
// The comment this carries over from dispatchInvite is worth keeping,
// because both halves are non-obvious. We ask Supabase for a magiclink
// but deliberately do NOT use the returned action_link: it routes
// through Supabase's /auth/v1/verify endpoint and, on PKCE projects,
// redirects with ?code=, which a server-side exchange cannot complete
// without a client-side code_verifier that admin-issued flows never
// set. So we take the hashed_token and build our own link.
//
// And it points straight at /accept-invite rather than hopping through
// /auth/callback, because verifyOtp then only fires when the user
// submits the password form. Link previewers and scanners — SafeLinks,
// iMessage, Slack unfurl — that GET the URL never consume the one-shot
// token.
export async function generateAcceptLink(input: {
  admin: SupabaseClient;
  // The instance's own URL. NOT the provisioning machine's.
  appUrl: string;
  email: string;
}): Promise<AcceptLinkResult> {
  const { data, error } = await input.admin.auth.admin.generateLink({
    type: "magiclink",
    email: input.email,
    options: { redirectTo: `${input.appUrl}/accept-invite` },
  });

  if (error) {
    return {
      ok: false,
      message: `Couldn't generate a sign-in link: ${error.message}`,
    };
  }

  const hashedToken = (data as { properties?: { hashed_token?: string } })
    ?.properties?.hashed_token;
  if (!hashedToken) {
    return {
      ok: false,
      message: "Couldn't generate a sign-in link for this user.",
    };
  }

  return {
    ok: true,
    link:
      `${input.appUrl}/accept-invite` +
      `?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink`,
  };
}
