import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { renderLeadReport } from "@/lib/lead-analysis/pdf/render";
import { reportFileName } from "@/lib/lead-analysis/context";
import type { LeadAnalysisRow } from "@/lib/lead-analysis/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// System admins only, here and in RLS (0265).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole(["system_admin"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: row } = await supabase
    .from("lead_meeting_analyses")
    .select("*")
    .eq("id", id)
    .maybeSingle<LeadAnalysisRow>();
  if (!row) return new NextResponse("Not found", { status: 404 });
  if (row.status !== "complete") {
    return new NextResponse("This analysis isn't finished yet.", { status: 409 });
  }

  const pdf = await renderLeadReport(row);
  const name = reportFileName(row.company_name, row.full_name);
  // ?view opens it in the browser tab; otherwise it downloads.
  const disposition = new URL(request.url).searchParams.has("view") ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
