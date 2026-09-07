import { describe, it, expect } from "vitest";

import { generateDbPassword, mergeState, pickApiKeys } from "./state.ts";

describe("pickApiKeys", () => {
  // The shape a real project returned (aims-higher-provtest1). Four
  // keys, and the two new-format ones share the name "default".
  const REAL = [
    { name: "anon", type: "legacy", api_key: "eyJhbGciOiJIUzI1NiJ9.anon" },
    { name: "service_role", type: "legacy", api_key: "eyJhbGciOiJIUzI1NiJ9.service" },
    { name: "default", type: "publishable", api_key: "sb_publishable_abc" },
    { name: "default", type: "secret", api_key: "sb_secret_xyz" },
  ];

  it("prefers the new-format keys over the legacy JWTs", () => {
    // Production already runs on the new format, and matching on name
    // would pick the legacy pair — which an earlier version did.
    expect(pickApiKeys(REAL)).toEqual({
      anonKey: "sb_publishable_abc",
      serviceKey: "sb_secret_xyz",
    });
  });

  it("cannot be fooled by both new keys sharing a name", () => {
    const both = REAL.filter((k) => k.name === "default");
    expect(pickApiKeys(both)).toEqual({
      anonKey: "sb_publishable_abc",
      serviceKey: "sb_secret_xyz",
    });
  });

  it("falls back to the legacy names for a project with no new keys", () => {
    const legacyOnly = REAL.filter((k) => k.type === "legacy");
    expect(pickApiKeys(legacyOnly)).toEqual({
      anonKey: "eyJhbGciOiJIUzI1NiJ9.anon",
      serviceKey: "eyJhbGciOiJIUzI1NiJ9.service",
    });
  });

  it("returns undefined rather than guessing when a key is absent", () => {
    expect(pickApiKeys([])).toEqual({
      anonKey: undefined,
      serviceKey: undefined,
    });
  });
});

describe("generateDbPassword", () => {
  it("uses only characters that are safe inside a connection URI", () => {
    // The password goes into a postgres URI for the migration step.
    // "+" and "/" from plain base64, or ":" "@" "?" "#", either need
    // escaping or silently truncate the URI.
    for (let i = 0; i < 50; i += 1) {
      expect(generateDbPassword()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("is long enough to be worth generating", () => {
    expect(generateDbPassword().length).toBeGreaterThanOrEqual(40);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateDbPassword()));
    expect(seen.size).toBe(50);
  });
});

describe("mergeState", () => {
  it("never drops a value an earlier run recorded", () => {
    // Losing dbPassword is unrecoverable: the Management API shows it
    // once and the migration step needs it.
    const first = mergeState(null, { subdomain: "x", dbPassword: "pw" }, "t1");
    const second = mergeState(first, { projectRef: "ref1" }, "t2");

    expect(second.dbPassword).toBe("pw");
    expect(second.projectRef).toBe("ref1");
    expect(second.createdAt).toBe("t1");
    expect(second.updatedAt).toBe("t2");
  });

  it("ignores undefined rather than writing it over a real value", () => {
    const first = mergeState(null, { subdomain: "x", anonKey: "a" }, "t1");
    const second = mergeState(first, { anonKey: undefined }, "t2");
    expect(second.anonKey).toBe("a");
  });
});
