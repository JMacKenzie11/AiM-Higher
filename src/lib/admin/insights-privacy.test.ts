import { describe, it, expect } from "vitest";
import { companiesWithEnoughPeople, examplesAllowed, scopeCompanyView } from "./insights-privacy";

const convos = (company: string, people: number) =>
  Array.from({ length: people }, (_, i) => ({ company_id: company, created_by: `${company}-p${i}` }));

describe("the four limits on the insights card", () => {
  it("shows a company on its own only with 5 or more people in the period", () => {
    const eligible = companiesWithEnoughPeople([...convos("big", 5), ...convos("small", 3), ...convos("small", 3)]);
    expect([...eligible]).toEqual(["big"]);
    expect(scopeCompanyView(["big", "small"], 30, eligible)).toEqual({ companyIds: ["big"], refused: null });
    expect(scopeCompanyView(["small"], 30, eligible)).toEqual({ companyIds: [], refused: "people" });
  });

  it("refuses a company view shorter than a month, and never refuses All companies", () => {
    const eligible = new Set(["big"]);
    expect(scopeCompanyView(["big"], 7, eligible)).toEqual({ companyIds: [], refused: "period" });
    expect(scopeCompanyView([], 1, eligible)).toEqual({ companyIds: [], refused: null });
  });

  it("allows example sentences only from 3 people across 2 companies", () => {
    expect(examplesAllowed(new Set(["a", "b", "c"]), new Set(["x", "y"]))).toBe(true);
    expect(examplesAllowed(new Set(["a", "b", "c"]), new Set(["x"]))).toBe(false);
    expect(examplesAllowed(new Set(["a", "b"]), new Set(["x", "y"]))).toBe(false);
  });
});
