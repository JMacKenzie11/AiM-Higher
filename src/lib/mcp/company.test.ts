import { describe, expect, it } from "vitest";
import { chooseCompany } from "./company";

const acme = { id: "11111111-1111-4111-8111-111111111111", name: "Acme" };
const holdings = { id: "22222222-2222-4222-8222-222222222222", name: "Acme Holdings" };

describe("which company a request is about", () => {
  it("fills in the one company a person can see", () => {
    expect(chooseCompany([acme], undefined)).toEqual({ ok: true, company: acme });
    expect(chooseCompany([acme], "  ")).toEqual({ ok: true, company: acme });
  });

  it("asks somebody who sees several to name one, and lists them", () => {
    const r = chooseCompany([acme, holdings], undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("company_required");
      expect(r.message).toContain("Acme Holdings");
    }
  });

  it("takes an id or a whole name, ignoring case", () => {
    expect(chooseCompany([acme, holdings], holdings.id)).toEqual({ ok: true, company: holdings });
    expect(chooseCompany([acme, holdings], " acme ")).toEqual({ ok: true, company: acme });
  });

  it("never matches part of a name", () => {
    const r = chooseCompany([holdings], "Acme");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("company_unknown");
  });

  it("refuses a company the person cannot see, even by id", () => {
    const r = chooseCompany([acme], holdings.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("company_unknown");
  });

  it("asks for the id when two companies share a name", () => {
    const twin = { id: "33333333-3333-4333-8333-333333333333", name: "acme" };
    const r = chooseCompany([acme, twin], "Acme");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("company_ambiguous");
  });

  it("says so when the person is in no company", () => {
    const r = chooseCompany([], undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_company");
  });
});
