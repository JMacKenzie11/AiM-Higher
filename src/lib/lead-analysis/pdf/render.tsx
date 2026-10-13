import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import type { LeadAnalysisRow } from "../types";
import { LeadReport } from "./LeadReport";

// Rendered on request from the stored analysis, never stored itself:
// the analysis is the record, and a fix to the layout reaches every
// past report the next time it is downloaded.
export async function renderLeadReport(row: LeadAnalysisRow): Promise<Buffer> {
  return renderToBuffer(<LeadReport row={row} />);
}
