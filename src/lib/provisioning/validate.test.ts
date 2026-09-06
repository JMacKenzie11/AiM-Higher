import { describe, it, expect } from "vitest";

import {
  REQUIRED_CONFIG,
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_MAX,
  SUBDOMAIN_MIN,
  envPrefixFor,
  missingConfig,
  validateAdminEmail,
  validateSubdomain,
} from "./validate";

// Provisioning creates a database, rewrites production environment
// variables and publishes a hostname. Everything here runs before any
// of that, so these tests are the cheap half of not half-provisioning
// a customer.

describe("validateSubdomain", () => {
  it("accepts an ordinary name and derives its env prefix", () => {
    expect(validateSubdomain("acmecapital")).toEqual({
      ok: true,
      subdomain: "acmecapital",
      envPrefix: "ACMECAPITAL",
    });
  });

  it("accepts digits and interior hyphens", () => {
    expect(validateSubdomain("acme-capital-2")).toEqual({
      ok: true,
      subdomain: "acme-capital-2",
      envPrefix: "ACME_CAPITAL_2",
    });
  });

  it("turns hyphens into underscores for the env prefix", () => {
    // A hyphen is legal in a hostname and not in an environment
    // variable name, so ACME-CAPITAL_SUPABASE_URL would be unreadable
    // by anything.
    expect(envPrefixFor("acme-capital")).toBe("ACME_CAPITAL");
    expect(envPrefixFor("a-b-c")).toBe("A_B_C");
    expect(envPrefixFor("acme")).toBe("ACME");
  });

  it("trims surrounding whitespace", () => {
    const result = validateSubdomain("  acmecapital  ");
    expect(result.ok && result.subdomain).toBe("acmecapital");
  });

  it("rejects every reserved name", () => {
    for (const reserved of RESERVED_SUBDOMAINS) {
      const result = validateSubdomain(reserved);
      expect(result.ok, `${reserved} should be reserved`).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/reserved/i);
    }
  });

  it("reserves the apex and www for the reason that matters", () => {
    // "@" is the apex row. Handing it to a customer would point the
    // marketing site and every unscoped hostname at their database.
    expect(RESERVED_SUBDOMAINS).toContain("@");
    expect(RESERVED_SUBDOMAINS).toContain("www");
  });

  it("rejects uppercase rather than silently downcasing", () => {
    // Silently fixing it would create a row whose subdomain never
    // matches the lowercased hostname the resolver looks up.
    const result = validateSubdomain("AcmeCapital");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/lowercase/i);
  });

  it("rejects illegal characters and names them", () => {
    for (const bad of ["acme_capital", "acme.capital", "acme capital", "acmé"]) {
      const result = validateSubdomain(bad);
      expect(result.ok, `${bad} should be rejected`).toBe(false);
    }
    const underscore = validateSubdomain("acme_capital");
    if (!underscore.ok) expect(underscore.message).toContain('"_"');
  });

  it("rejects a leading or trailing hyphen", () => {
    for (const bad of ["-acme", "acme-", "-acme-"]) {
      const result = validateSubdomain(bad);
      expect(result.ok, `${bad} should be rejected`).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/hyphen/i);
    }
  });

  it("enforces the length bounds", () => {
    expect(validateSubdomain("ab").ok).toBe(false);
    expect(validateSubdomain("a".repeat(SUBDOMAIN_MIN)).ok).toBe(true);
    expect(validateSubdomain("a".repeat(SUBDOMAIN_MAX)).ok).toBe(true);
    expect(validateSubdomain("a".repeat(SUBDOMAIN_MAX + 1)).ok).toBe(false);
  });

  it("rejects a name whose prefix would not be a legal variable", () => {
    // "1acme" passes the character rules and derives "1ACME", so
    // 1ACME_SUPABASE_URL — legal in some shells, not all, which is the
    // kind of thing that fails in one environment months later.
    const result = validateSubdomain("1acme");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/environment variable/i);
  });

  it("rejects an empty subdomain", () => {
    expect(validateSubdomain("").ok).toBe(false);
    expect(validateSubdomain("   ").ok).toBe(false);
  });
});

describe("validateAdminEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const email of [
      "jeff@acmecapital.com",
      "jeff.bouwman+aims@acme-capital.co.uk",
      "j@a.io",
    ]) {
      expect(validateAdminEmail(email), email).toEqual({ ok: true, email });
    }
  });

  it("trims whitespace", () => {
    expect(validateAdminEmail("  jeff@acme.com ")).toEqual({
      ok: true,
      email: "jeff@acme.com",
    });
  });

  it("rejects the typo class", () => {
    for (const bad of [
      "",
      "jeff",
      "jeff@",
      "@acme.com",
      "jeff@acme",
      "jeff @acme.com",
      "jeff@acme .com",
      "jeff@acme.c",
    ]) {
      expect(validateAdminEmail(bad).ok, `${bad} should be rejected`).toBe(
        false
      );
    }
  });
});

describe("missingConfig", () => {
  const complete = Object.fromEntries(
    REQUIRED_CONFIG.map((name) => [name, "set"])
  );

  it("returns nothing when everything is present", () => {
    expect(missingConfig(complete)).toEqual([]);
  });

  it("names every missing variable, not just the first", () => {
    // "Some config is missing" sends someone reading source.
    expect(missingConfig({})).toEqual([...REQUIRED_CONFIG]);
  });

  it("treats empty and whitespace-only as missing", () => {
    expect(missingConfig({ ...complete, VERCEL_TOKEN: "" })).toEqual([
      "VERCEL_TOKEN",
    ]);
    expect(missingConfig({ ...complete, VERCEL_TOKEN: "   " })).toEqual([
      "VERCEL_TOKEN",
    ]);
  });

  it("requires the tokens that can create and publish", () => {
    // Each of these is a capability: create a database, rewrite
    // production env, publish a hostname.
    expect(REQUIRED_CONFIG).toContain("SUPABASE_MANAGEMENT_TOKEN");
    expect(REQUIRED_CONFIG).toContain("VERCEL_TOKEN");
    expect(REQUIRED_CONFIG).toContain("VERCEL_PROJECT_ID");
    expect(REQUIRED_CONFIG).toContain("CONTROL_PLANE_SUPABASE_URL");
    expect(REQUIRED_CONFIG).toContain("CONTROL_PLANE_SUPABASE_SERVICE_KEY");
  });
});
