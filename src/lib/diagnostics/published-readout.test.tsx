import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { isReadoutData } from "./readout";
import { ReadoutPdf } from "./pdf/ReadoutPdf";
import { ReadoutView } from "@/app/(app)/diagnostics/[id]/readout/ReadoutView";

// A READOUT PUBLISHED BEFORE PHASE 4 RENDERS EXACTLY AS IT DID. The
// readout page and the PDF render a published diagnostic from its
// stored published_readout, and one stored before the Systems and AI
// Snapshot has no systems in it. __golden__ holds such a readout as
// stored, the page's markup and the PDF's digest, both captured from the
// code as it was before phase 4 (2026-10-23, main at 21b736f3). A change
// that alters either for an old readout fails here.

const golden = (f: string) => readFileSync(path.join(__dirname, "__golden__", f), "utf8");
// The PDF carries its creation time and a random ID, and the two logos
// load at once, so whichever finishes first is written first: the same
// objects come out in a different order, and numbered to match. So the
// digest is of every object's content, references unnumbered, in sorted
// order. Every stream (text, fonts, images) is still in it byte for
// byte; only where each sits in the file is not.
const stable = (b: Buffer) => {
  const s = b.toString("latin1").replace(/\(D:[0-9Z'+-]+\)/g, "(D:)");
  const objects = [...s.matchAll(/\n\d+ 0 obj\n([\s\S]*?)\nendobj/g)].map((m) => m[1].replace(/\b\d+ 0 R\b/g, "R"));
  return objects.sort().join("\u0000");
};

describe("a readout published before phase 4", () => {
  const stored: unknown = JSON.parse(golden("published-v1.json"));

  it("is still a readout, with its Guardrails section and no systems", () => {
    expect(isReadoutData(stored)).toBe(true);
    expect(stored).not.toHaveProperty("systems");
  });

  it("renders the same page", () => {
    if (!isReadoutData(stored)) throw new Error("not a readout");
    expect(renderToStaticMarkup(<ReadoutView r={stored} />) + "\n").toBe(golden("readout-v1.html"));
  });

  it("renders the same PDF", async () => {
    if (!isReadoutData(stored)) throw new Error("not a readout");
    const digest = createHash("sha256").update(stable(await renderToBuffer(<ReadoutPdf r={stored} />))).digest("hex");
    expect(digest + "\n").toBe(golden("readout-v1.pdf.sha256"));
  }, 60_000);
});
