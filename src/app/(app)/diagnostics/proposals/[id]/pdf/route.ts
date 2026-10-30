import { NextResponse } from "next/server";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { getProposal } from "@/lib/diagnostics/service";
import { proposalFileName, renderProposalPdf } from "@/lib/diagnostics/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A proposal as a PDF (0312), rendered on request: the frozen row once
// published, the draft (marked as one) before. System admins on the
// primary instance, here and in RLS.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireDiagnostics();
  const { id } = await params;
  const found = await getProposal(id);
  if (!found) return new NextResponse("Not found", { status: 404 });
  const { proposal, client } = found;
  const pdf = await renderProposalPdf(proposal, client);
  const name = proposalFileName(proposal, proposal.client_name ?? client.name);
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
