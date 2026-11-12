import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { exchangeMicrosoftCodeAndPersist, needsAdminApproval } from "@/lib/connections/microsoft";
import { APP_URL } from "@/lib/supabase/env";

// Where Microsoft sends people back, for two different trips, both
// started from Company settings by someone who manages the company's
// connections, and both carrying state nonce.company[.approve] that
// must match the cookie their start route set:
//
//   1. Approve (from /api/oauth/microsoft/approve): a Microsoft 365
//      admin approved AiMS HQ for their organisation, or didn't.
//      ?admin_consent=True. Nothing is stored; the person goes back to
//      the company's settings with ms_approved=1, which shows Connect.
//
//   2. Connect (from /api/oauth/microsoft/start): ?code=. The tokens
//      are stored in the vault (0325). The same checks as Google's.
//
// One address for both because each address must be registered in
// Entra by hand, per instance.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "microsoft_oauth_state";

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");

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
  const parts = state && stored && state === stored ? state.split(".") : [];
  const companyId = parts[1] ?? "";
  const approving = parts[2] === "approve";
  const destination = companyId ? `${APP_URL()}/admin/companies/${companyId}` : fallback;

  if (approving) {
    if (!isAdminForCompany(session.profile, companyId)) {
      return NextResponse.redirect(`${fallback}?ms_error=forbidden`);
    }
    if (url.searchParams.get("admin_consent") === "True") {
      return NextResponse.redirect(`${destination}?ms_approved=1#connections`);
    }
    // Most often: the account used is not a Microsoft 365 admin.
    return NextResponse.redirect(`${destination}?ms_not_approved=1#connections`);
  }

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
