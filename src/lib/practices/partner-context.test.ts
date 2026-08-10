import { describe, it, expect } from "vitest";
import { formatPartnerContext } from "./partner-context";

// The partner_context block is the practice framework's most sensitive
// surface: it's often a team member talking about a peer, and the
// coach must never see that peer's strengths, coaching threads, or
// verbatim missed-commitment reasons. This suite locks the allow-list
// down as an explicit contract — if a future refactor accidentally
// widens the shape, one of these assertions will trip.

describe("formatPartnerContext", () => {
  const baseInput = {
    fullName: "Rita Alvarez",
    position: "Senior Estimator",
    relationship: "peer or other",
    openCommitments: [
      { description: "Send the M&E scope to the GC", due_date: "2026-08-15" },
    ],
    followThroughRate: 82,
    quarterLabel: "2026 Q3",
  };

  it("includes exactly the allow-listed fields", () => {
    const out = formatPartnerContext(baseInput);

    // Present: name, position, relationship, open commitment,
    // follow-through rate, quarter label.
    expect(out).toContain("Rita Alvarez");
    expect(out).toContain("Senior Estimator");
    expect(out).toContain("peer or other");
    expect(out).toContain("Send the M&E scope to the GC");
    expect(out).toContain("2026-08-15");
    expect(out).toContain("82%");
    expect(out).toContain("2026 Q3");
  });

  it("never leaks strengths, coaching, or missed-reason data", () => {
    const out = formatPartnerContext(baseInput);

    // The disclaimer line explicitly names the excluded fields so
    // the model is told out loud what's NOT present. That naming is
    // valid; what we're testing is that the DATA section (everything
    // before the disclaimer) contains none of these concepts.
    expect(out).toMatch(/No strengths, no coaching notes, no missed/i);
    const disclaimerIdx = out.indexOf("This is all the platform data");
    expect(disclaimerIdx).toBeGreaterThan(0);
    const dataSection = out.slice(0, disclaimerIdx).toLowerCase();

    // These strings must not appear ANYWHERE in the data section.
    // Rename-and-forget style leaks (e.g. adding a "strength: ..."
    // line to the formatter) trip here.
    const forbidden = [
      "strength",
      "superpower",
      "assessment",
      "coaching",
      "missed_reason",
      "missed reason",
      "reason:",
      // Priorities and goals are also excluded from partner_context
      // even though person_context includes them.
      "priorit",
      "annual goal",
    ];
    for (const banned of forbidden) {
      expect(dataSection).not.toContain(banned.toLowerCase());
    }
  });

  it("handles the empty-commitments and missing-quarter edges", () => {
    const out = formatPartnerContext({
      ...baseInput,
      openCommitments: [],
      followThroughRate: null,
      quarterLabel: null,
    });
    expect(out).toContain("(none open)");
    expect(out).toContain("no open quarter on file");
    // Even in the sparse case, the disclaimer must ride along.
    expect(out).toMatch(/No strengths, no coaching notes/);
  });

  it("renders each relationship label the caller passes through", () => {
    for (const rel of ["direct report", "manager", "peer or other"]) {
      const out = formatPartnerContext({ ...baseInput, relationship: rel });
      expect(out).toContain(
        `Reporting relationship to the participant: ${rel}`
      );
    }
  });
});
