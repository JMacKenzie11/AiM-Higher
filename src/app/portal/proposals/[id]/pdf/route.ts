import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { getPortalProposal } from "@/lib/diagnostics/service";
import { proposalFileName, renderProposalPdf } from "@/lib/diagnostics/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The owner's proposal as a PDF (0312). A route handler sits outside
// the portal layout, so it checks the role itself; the proposal comes
// through portal_proposal(), which returns it only to the owner it is
// addressed to.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireProfile();
  if (session.profile.role !== "diagnostic_client") return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  const p = await getPortalProposal(id);
  if (!p) return new NextResponse("Not found", { status: 404 });
  const clientName = p.client_name ?? "";
  const pdf = await renderProposalPdf(p, { name: clientName, owner_name: p.owner_name });
  const name = proposalFileName(p, clientName);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w .()-]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
