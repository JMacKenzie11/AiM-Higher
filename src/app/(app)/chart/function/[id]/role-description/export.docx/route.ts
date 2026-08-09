import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeReadiness } from "@/lib/role-descriptions/readiness";
import {
  getCachedRoleDescription,
  isCacheStale,
  saveRoleDescription,
} from "@/lib/role-descriptions/cache";
import { generateRoleDescription } from "@/lib/role-descriptions/generate";
import { buildRoleDescriptionDocx } from "@/lib/role-descriptions/docx";

// GET /chart/function/[id]/role-description/export.docx
//
// Downloads the assembled Role Description as a Word document.
// Same access rules as the view page — admins can pull an
// in-progress preview, everyone else needs allReady. Uses the
// cache when fresh so the download is instant; regenerates
// on stale/miss with the same auto-save so the view page
// benefits from the same warm cache afterward.

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _req: Request,
  { params }: RouteContext
): Promise<Response> {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getChartFunctionDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rdEnabled = await companyHasFeature(
    detail.fn.company_id,
    "role_descriptions"
  );
  if (!rdEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const canViewAnytime = isAdminForCompany(
    session.profile,
    detail.fn.company_id
  );
  const readiness = computeReadiness(detail);
  if (!canViewAnytime && !readiness.allReady) {
    return NextResponse.json(
      { error: "Role description isn't ready yet." },
      { status: 403 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", detail.fn.company_id)
    .maybeSingle<{ name: string }>();

  const cached = await getCachedRoleDescription(detail.fn.id);
  let doc = null;
  if (cached && !isCacheStale(cached, detail)) {
    doc = cached.document;
  } else {
    doc = await generateRoleDescription(detail);
    if (doc) {
      await saveRoleDescription({
        functionId: detail.fn.id,
        generatedBy: session.profile.id,
        document: doc,
      });
    } else if (cached) {
      doc = cached.document;
    }
  }

  const buffer = await buildRoleDescriptionDocx({
    detail,
    companyName: company?.name ?? null,
    doc,
  });

  const filename = `Role Description - ${sanitizeFilename(detail.fn.title)}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// Word/macOS/Windows all handle most Unicode filenames fine, but
// strip characters that break Content-Disposition parsing (quotes,
// semicolons, control chars) and normalize whitespace so the
// downloaded file is easy to sort in a folder.
function sanitizeFilename(raw: string): string {
  const trimmed = raw
    .replace(/["/\\:*?<>|]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed || "Untitled";
}
