import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { loadVisionForCaller } from "@/lib/foundation/vivid-vision-source";
import { renderVividVisionPdf, vividVisionFileName } from "@/lib/foundation/vivid-vision-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vivid-vision/pdf?conversation=<id>&message=<id>
//
// The Vivid Vision Coach's finished document as a PDF (Jason,
// 2026-11-02). Read as the caller (vivid-vision-source.ts): whoever
// can see the card can download it, as they can copy it. It reads;
// nothing is written.
export async function GET(request: Request) {
  await requireProfile();
  const url = new URL(request.url);
  const vision = await loadVisionForCaller(url.searchParams.get("conversation") ?? "", url.searchParams.get("message") ?? "");
  if (!vision) return new NextResponse("Not found", { status: 404 });

  const pdf = await renderVividVisionPdf(vision.doc, vision.companyName, vision.year);
  const name = vividVisionFileName(vision.companyName, vision.year);
  // ?view opens it in the browser tab; otherwise it downloads.
  const disposition = url.searchParams.has("view") ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${name.replace(/[^\w .()-]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
