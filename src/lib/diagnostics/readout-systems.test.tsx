import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { assembleReadout, readoutFigures, sectionTitle } from "./readout";
import { checkNarrative, narrativeInput } from "./narrative";
import { readoutBundle } from "./readout.fixture";
import { frontOffice } from "./systems.fixture";
import { ReadoutPdf } from "./pdf/ReadoutPdf";
import { ReadoutView } from "@/app/(app)/diagnostics/[id]/readout/ReadoutView";
import type { DiagnosticBundle } from "./types";

const TODAY = "2026-10-22";

// The readout fixture with the front office's systems and AI answers.
function withSystems(): DiagnosticBundle {
  const b = readoutBundle();
  const office = frontOffice();
  return { ...b, participants: office.participants, tasks: office.tasks, systems: office.systems, links: office.links, aiUse: office.aiUse };
}

describe("the readout without systems data", () => {
  it("keeps the Guardrails section, so a diagnostic in progress is not broken", () => {
    const r = assembleReadout(readoutBundle(), TODAY);
    expect(r).not.toHaveProperty("systems");
    expect(sectionTitle("guardrails", r)).toBe("Guardrails Snapshot");
    const html = renderToStaticMarkup(<ReadoutView r={r} />);
    expect(html).toContain("Guardrails Snapshot");
    expect(html).toContain("Tools in use");
    expect(html).not.toContain("Systems and AI Snapshot");
  });

  it("gains the Systems and AI Snapshot from one None answer alone", () => {
    const b = readoutBundle();
    b.participants = b.participants.map((p, i) => ({ ...p, uses_no_ai: i === 0 }));
    expect(assembleReadout(b, TODAY).systems?.ai).toMatchObject({ answered: 1, usingAny: 0 });
  });
});

describe("the Systems and AI Snapshot", () => {
  const r = assembleReadout(withSystems(), TODAY);

  it("takes the Guardrails section's place, with the map, the top hand-carried connections, AI counts and the rules", () => {
    expect(sectionTitle("guardrails", r)).toBe("Systems and AI Snapshot");
    expect(r.systems!.handCarried).toEqual([
      { from: "Outlook", to: "Epicor", whatMoves: ["Orders"], hours: 10 },
      { from: "Quote sheet", to: "QuickBooks", whatMoves: ["Invoices"], hours: 5 },
    ]);
    const html = renderToStaticMarkup(<ReadoutView r={r} />);
    expect(html).toContain("Systems and AI Snapshot");
    expect(html).not.toContain("Guardrails Snapshot");
    expect(html).toContain("10 hours a week by hand");
    expect(html).toContain("3 of 4");
    expect(html).toContain("A person reads every draft before it goes out");
    expect(html).toContain("Customer contact details, pricing");
    expect(html).toMatch(/data-testid="system-arrow"/);
  });

  it("names no more than three connections", () => {
    const b = withSystems();
    b.links = [...b.links, { ...b.links[0], id: "l4", from_system_id: "s-books", to_system_id: "s-email", what_moves: "Statements", how: "export_import" }, { ...b.links[0], id: "l5", from_system_id: "s-erp", to_system_id: "s-sheet", what_moves: "Prices", how: "retyped" }];
    expect(assembleReadout(b, TODAY).systems!.handCarried).toHaveLength(3);
  });

  it("lets the narrative use the section's figures and drops a paragraph with any other", () => {
    const figures = readoutFigures(r);
    for (const f of ["10", "5", "15", "4", "3", "2", "1"]) expect(figures).toContain(f);
    const { narrative, dropped } = checkNarrative(
      {
        guardrails: { evidence: [], paragraph: "Your team carries 15 hours a week between systems by hand, 10 of them from Outlook into Epicor. 3 of 4 people use an AI tool." },
        hours_back: { evidence: [], paragraph: "Hand-carrying adds 21 hours to what came back." },
      },
      r
    );
    expect(narrative.guardrails).toContain("15 hours");
    expect(dropped).toEqual(["hours_back"]);
  });

  it("renders in the PDF", async () => {
    const pdf = await renderToBuffer(<ReadoutPdf r={r} />);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);
});

describe("privacy: AI use reaches the owner as counts and tool names only", () => {
  const b = withSystems();
  const r = assembleReadout(b, TODAY);
  // The whole narrative input for the AI rows' words; its own section
  // for names, since an approved quote the lead chose to name carries
  // that name elsewhere in the readout, as it always has.
  const input = narrativeInput(r, null);
  const inputSection = JSON.stringify(JSON.parse(input).readout.systems_and_ai_snapshot);
  const section = JSON.stringify(r.systems);

  it("holds nothing from a participant's own AI rows but the tool names", () => {
    for (const u of b.aiUse) {
      if (u.used_for) {
        expect(section).not.toContain(u.used_for);
        expect(input).not.toContain(u.used_for);
      }
      if (u.never_share) {
        expect(section).not.toContain(u.never_share);
        expect(input).not.toContain(u.never_share);
      }
      expect(section).not.toContain(u.participant_id);
      expect(input).not.toContain(u.participant_id);
    }
    for (const p of b.participants) {
      expect(section).not.toContain(p.name);
      expect(inputSection).not.toContain(p.name);
    }
    expect(Object.keys(r.systems!.ai).sort()).toEqual(["answered", "companyProvided", "personal", "tools", "usingAny", "usingPersonal"]);
    expect(r.systems!.ai.tools.every((t) => Object.keys(t).sort().join() === "tool,users")).toBe(true);
  });

  it("is built from the summary: the same summary gives the same section, whoever the rows belong to", () => {
    const swapped = withSystems();
    // The same tools, held by different people: the owner's view cannot tell.
    swapped.aiUse = swapped.aiUse.map((u) => (u.participant_id === "p1" ? { ...u, participant_id: "p2" } : u.participant_id === "p2" ? { ...u, participant_id: "p1" } : u));
    expect(assembleReadout(swapped, TODAY).systems!.ai).toEqual(r.systems!.ai);
  });
});
