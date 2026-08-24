import { after, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeReadiness } from "@/lib/role-descriptions/readiness";
import { mergeRoleDescription } from "@/lib/role-descriptions/generate";
import { getPublishedVersion } from "@/lib/role-descriptions/versions";
import { buildRoleDescriptionDocx } from "@/lib/role-descriptions/docx";
import { track } from "@/lib/analytics/track";

// GET /chart/function/[id]/role-description/v/[version]/export.docx
//
// Download a frozen published version as .docx. Renders from the
// snapshot's stored document + overrides, so a version's file
// stays byte-stable forever (unlike the live export which
// reflects current chart state).

type RouteContext = {
  params: Promise<{ id: string; version: string }>;
};

export async function GET(
  _req: Request,
  { params }: RouteContext
): Promise<Response> {
  const session = await requireProfile();
  const { id, version } = await params;
  const versionNumber = Number.parseInt(version, 10);
  if (!Number.isFinite(versionNumber) || versionNumber < 1) {
    return NextResponse.json({ error: "Bad version" }, { status: 400 });
  }

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
  if (!canViewAnytime) {
    const readiness = computeReadiness(detail);
    if (!readiness.allReady) {
      return NextResponse.json(
        { error: "Role description isn't ready yet." },
        { status: 403 }
      );
    }
  }

  const snap = await getPublishedVersion(id, versionNumber);
  if (!snap) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", detail.fn.company_id)
    .maybeSingle<{ name: string }>();

  const doc = mergeRoleDescription(
    snap.snapshotDocument,
    snap.snapshotOverrides
  );
  const buffer = await buildRoleDescriptionDocx({
    detail,
    companyName: company?.name ?? null,
    doc,
  });

  const filename = `Role Description - ${sanitizeFilename(detail.fn.title)} - v${snap.versionNumber}.docx`;

  after(() =>
    track(
      session.profile.id,
      "export.docx.generated",
      {
        kind: "role_description",
        version: "published",
        version_number: snap.versionNumber,
      },
      { company: detail.fn.company_id }
    )
  );

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

function sanitizeFilename(raw: string): string {
  const trimmed = raw
    .replace(/["/\\:*?<>|]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed || "Untitled";
}
