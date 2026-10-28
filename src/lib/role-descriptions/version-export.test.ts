import { describe, it, expect } from "vitest";
import { versionExportSource } from "./version-export";

// The Download beside a Creator-written version used to build from
// snapshot_document, which is {} on those rows, and the builder
// threw on it. These hold the choice the route now makes.

const CREATOR_BODY = {
  version: 1,
  title: "Marketing Manager",
  function: { id: "11111111-1111-4111-8111-111111111111", title: "Marketing" },
  supports_functions: [],
  reports_to: "Dana Whitfield, Integrator",
  why_this_role_exists: "Because the pipeline is the constraint.",
  responsibilities: [
    { category: "Demand generation", description: "Everything upstream of a lead." },
  ],
  critical_success_factors: [],
  decision_rights: { decides: [], decides_with: [], recommends: [] },
  what_excellence_looks_like: [],
  capabilities: [],
  qualifications: [],
  why_this_role_matters: "Every other function is downstream of demand.",
};

const GENERATED = {
  positionSummary: "Owns demand.",
  outcomeEnrichments: [],
  responsibilityEnrichments: [],
  strengthsAndExpertise: {
    technical: [],
    strategic: [],
    interpersonal: [],
    accountability: "",
  },
  qualifications: { experience: "", education: "", certifications: "" },
  whyThisRoleMatters: "",
};

describe("versionExportSource", () => {
  it("builds a Creator version from its own document, not the empty snapshot", () => {
    const source = versionExportSource({
      bodyJson: CREATOR_BODY,
      snapshotDocument: {},
    });
    expect(source.kind).toBe("agent");
    if (source.kind === "agent") {
      expect(source.doc.title).toBe("Marketing Manager");
    }
  });

  it("builds a generator version from its snapshot", () => {
    const source = versionExportSource({
      bodyJson: null,
      snapshotDocument: GENERATED,
    });
    expect(source).toEqual({ kind: "generated", doc: GENERATED });
  });

  it("never hands the builder an empty snapshot", () => {
    expect(versionExportSource({ bodyJson: null, snapshotDocument: {} })).toEqual({
      kind: "generated",
      doc: null,
    });
  });

  it("falls back to the chart when a body will not parse", () => {
    expect(
      versionExportSource({ bodyJson: { title: "" }, snapshotDocument: {} })
    ).toEqual({ kind: "generated", doc: null });
  });
});
