import { NextResponse } from "next/server";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { getReadout } from "@/lib/diagnostics/service";
import { renderReadoutPdf } from "@/lib/diagnostics/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The readout PDF, rendered on request: the published copy once there
// is one, the draft before. System admins on the primary instance, here
// and in RLS (0294, 0295).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireDiagnostics();
  const { id } = await params;
  const found = await getReadout(id);
  if (!found) return new NextResponse("Not found", { status: 404 });
  const { readout, published } = found;
  const pdf = await renderReadoutPdf(readout);
  const name = `${readout.clientName} Capacity Diagnostic readout${published ? "" : " (draft)"}.pdf`;
  // ?view opens it in the browser tab; otherwise it downloads.
  const disposition = new URL(request.url).searchParams.has("view") ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${name.replace(/[^\w .()-]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
