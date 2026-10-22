import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import type { ReadoutData } from "../readout";
import { ReadoutPdf } from "./ReadoutPdf";

// Rendered on request, never stored: the published readout is the
// record, and a fix to the layout reaches every past readout the next
// time it is downloaded.
export async function renderReadoutPdf(r: ReadoutData): Promise<Buffer> {
  return renderToBuffer(<ReadoutPdf r={r} />);
}
