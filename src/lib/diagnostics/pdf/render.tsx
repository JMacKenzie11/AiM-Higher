import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import type { ReadoutData } from "../readout";
import { ReadoutPdf } from "./ReadoutPdf";
import { ProposalPdf, type ProposalPdfInput } from "./ProposalPdf";

// Rendered on request, never stored: the published readout is the
// record, and a fix to the layout reaches every past readout the next
// time it is downloaded.
export async function renderReadoutPdf(r: ReadoutData): Promise<Buffer> {
  return renderToBuffer(<ReadoutPdf r={r} />);
}

export async function renderProposalPdf(p: ProposalPdfInput, client: { name: string; owner_name: string | null }): Promise<Buffer> {
  return renderToBuffer(<ProposalPdf p={p} clientName={client.name} ownerName={client.owner_name} />);
}

// The file name a proposal downloads as.
export function proposalFileName(p: { title: string; version: number; published_at: string | null }, clientName: string): string {
  return `${clientName} ${p.title} v${p.version}${p.published_at ? "" : " (draft)"}.pdf`;
}
