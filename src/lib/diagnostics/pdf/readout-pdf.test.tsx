import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReadoutPdf } from "./ReadoutPdf";
import { assembleReadout } from "../readout";
import { readoutBundle } from "../readout.fixture";

// The readout PDF renders, with the map's dots, from a full readout and
// from one with nothing in it yet.
describe("ReadoutPdf", () => {
  it("renders a full readout", async () => {
    const r = assembleReadout(readoutBundle({ narrative: { hours_back: "Your first win gave back 6 hours a week." } }), "2026-10-22");
    const pdf = await renderToBuffer(<ReadoutPdf r={r} />);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("renders a readout with no first win, quotes or roadmap", async () => {
    const b = readoutBundle({ roadmap: [], tools_in_use: null, guardrail_rules: null, data_at_risk: null }, null);
    b.quotes = [];
    b.notes = [];
    const pdf = await renderToBuffer(<ReadoutPdf r={assembleReadout(b, "2026-10-22")} />);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);
});
