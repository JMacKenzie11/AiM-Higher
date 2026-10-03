import { describe, it, expect } from "vitest";
import { relationshipLine } from "./context";

// The relationship line in about mode (0261): anyone in a company can
// coach about anyone else, so Aimee is told which relationship it is.
const person = (id: string, name: string, reports_to: string | null = null, company_id: string | null = "co") => ({
  id,
  name,
  company_id,
  reports_to,
});

describe("relationshipLine", () => {
  it("names the participant as the manager of someone who reports to them", () => {
    expect(relationshipLine({ ...person("p", "Alex"), role: "team_member" }, person("s", "Sam", "p"))).toBe(
      "Relationship: Sam reports to Alex. Alex is their manager."
    );
  });

  it("names the subject as the participant's own manager", () => {
    expect(relationshipLine({ ...person("p", "Alex", "s"), role: "team_member" }, person("s", "Jordan"))).toMatch(
      /^Relationship: Alex reports to Jordan\. Jordan is Alex's own manager/
    );
  });

  it("calls two people who do not manage each other colleagues", () => {
    expect(relationshipLine({ ...person("p", "Alex", "m"), role: "team_member" }, person("s", "Priya", "m2"))).toMatch(
      /^Relationship: Alex and Priya are colleagues\./
    );
  });

  it("names a company admin who is not the manager as an admin", () => {
    expect(relationshipLine({ ...person("p", "Alex"), role: "company_admin" }, person("s", "Priya", "m2"))).toBe(
      "Relationship: Alex is one of the company's admins, and is not Priya's manager."
    );
  });

  it("names a guide or system admin from outside the company as an advisor", () => {
    for (const role of ["aims_guide", "system_admin", "portfolio_admin"] as const) {
      expect(relationshipLine({ ...person("p", "Robin", null, null), role }, person("s", "Priya"))).toBe(
        "Relationship: Robin works with this company as an AiMS advisor, and is not Priya's manager."
      );
    }
  });

  it("puts managing first, even for an advisor who manages the person", () => {
    expect(relationshipLine({ ...person("p", "Robin", null, null), role: "aims_guide" }, person("s", "Sam", "p"))).toMatch(
      /^Relationship: Sam reports to Robin\./
    );
  });
});
