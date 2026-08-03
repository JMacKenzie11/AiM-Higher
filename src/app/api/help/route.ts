import "server-only";

import { NextRequest } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { loadHelpForRoute } from "@/lib/help/loader";

// Read-only endpoint for the floating help widget. Given the current
// pathname, returns the best-matching help doc for the caller's role
// as { title, markdown }, or 204 if no doc exists (the widget
// renders a "help coming soon" message in that case).
//
// Auth-gated: the widget only appears on authenticated surfaces and
// the docs describe those surfaces, so no reason to leak them to
// anonymous callers.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireProfile();
  const pathname = new URL(req.url).searchParams.get("pathname");
  if (!pathname || !pathname.startsWith("/")) {
    return Response.json({ error: "missing pathname" }, { status: 400 });
  }
  const doc = await loadHelpForRoute(pathname, session.profile.role);
  if (!doc) return new Response(null, { status: 204 });
  return Response.json({ title: doc.title, markdown: doc.markdown });
}
