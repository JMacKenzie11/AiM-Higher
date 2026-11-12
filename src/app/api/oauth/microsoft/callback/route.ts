import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { exchangeMicrosoftCodeAndPersist, needsAdminApproval } from "@/lib/connections/microsoft";
import { APP_URL } from "@/lib/supabase/env";

// Where Microsoft sends people back, for two different trips:
//
//   1. A person connecting a company (from /api/oauth/microsoft/start):
//      ?code=&state=nonce.company. Checked against the state cookie and
//      the caller's right to manage that company, then the tokens are
//      stored in the vault (0325). The same checks as Google's callback.
//
//   2. A client's Microsoft 365 admin approving AiMS HQ for their
//      organisation (connections/microsoft.ts, adminConsentUrl):
//      ?admin_consent=True&tenant=... with state "admin-consent". That
//      admin is usually not an AiMS user at all, so this branch needs
//      no session and writes nothing: it only says thank you.
//
// One address for both because each address must be registered in
// Entra by hand, per instance.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "microsoft_oauth_state";

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");

  if (state === "admin-consent") {
    const approved = url.searchParams.get("admin_consent") === "True";
    return NextResponse.redirect(
      `${APP_URL()}/microsoft-approved?${approved ? "ok=1" : `error=${encodeURIComponent(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "not approved")}`}`
    );
  }

  const session = await requireProfile();
  if (!["system_admin", "company_admin", "aims_guide", "portfolio_admin"].includes(session.profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const cookieStore = await cookies();
  const stored = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  const fallback = `${APP_URL()}/admin/companies`;
  // The company comes from the state only once it matches the cookie.
  const companyId = state && stored && state === stored ? state.split(".")[1] ?? "" : "";
  const destination = companyId ? `${APP_URL()}/admin/companies/${companyId}` : fallback;

  if (error) {
    const flag = needsAdminApproval(`${error} ${errorDescription ?? ""}`) ? "ms_needs_admin=1" : `ms_error=${encodeURIComponent(error)}`;
    return NextResponse.redirect(`${destination}?${flag}${companyId ? "#connections" : ""}`);
  }
  if (!code || !companyId) {
    return NextResponse.redirect(`${fallback}?ms_error=invalid_state`);
  }
  if (!isAdminForCompany(session.profile, companyId)) {
    return NextResponse.redirect(`${fallback}?ms_error=forbidden`);
  }

  try {
    const account = await exchangeMicrosoftCodeAndPersist(code, companyId, session.profile.id);
    return NextResponse.redirect(`${destination}?ms_connected=${encodeURIComponent(account)}#connections`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "connect_failed";
    const flag = needsAdminApproval(message) ? "ms_needs_admin=1" : `ms_error=${encodeURIComponent(message)}`;
    return NextResponse.redirect(`${destination}?${flag}#connections`);
  }
}
