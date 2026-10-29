import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { getPortalReadout } from "@/lib/diagnostics/service";
import { renderReadoutPdf } from "@/lib/diagnostics/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The client's published readout as a PDF (0310). A route handler sits
// outside the portal layout, so it checks the role itself; the
// readout comes through portal_readout(), which returns only the
// caller's own client's published readout.
export async function GET() {
  const session = await requireProfile();
  if (session.profile.role !== "diagnostic_client") return new NextResponse("Not found", { status: 404 });
  const r = await getPortalReadout();
  if (!r) return new NextResponse("Not found", { status: 404 });
  const pdf = await renderReadoutPdf(r);
  const name = `${r.clientName} Capacity Diagnostic readout.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w .()-]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
