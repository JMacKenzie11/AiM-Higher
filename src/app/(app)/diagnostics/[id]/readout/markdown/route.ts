import { NextResponse } from "next/server";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { getReadout } from "@/lib/diagnostics/service";
import { readoutMarkdown } from "@/lib/diagnostics/readout";

export const dynamic = "force-dynamic";

// The lead's Markdown copy of the roadmap, the Top 3 next wins and the
// Capacity Destination, to type into the platform by hand if the sprint
// starts. System admins on the primary instance (0294, 0295).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireDiagnostics();
  const { id } = await params;
  const found = await getReadout(id);
  if (!found) return new NextResponse("Not found", { status: 404 });
  const name = `${found.readout.clientName} roadmap.md`;
  return new NextResponse(readoutMarkdown(found.readout), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w .()-]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
