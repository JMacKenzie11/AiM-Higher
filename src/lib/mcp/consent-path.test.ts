import { describe, it, expect } from "vitest";
import { consentPathFor, isAuthorizationId, isConsentReturnPath } from "./consent-path";

// Sign-in may send a person back to an outside assistant's consent
// request and nowhere else.
describe("isConsentReturnPath", () => {
  it("accepts the consent request it was built for", () => {
    expect(isConsentReturnPath(consentPathFor("abc123DEF_-xyz"))).toBe(true);
  });

  it("refuses anywhere else, including look-alikes", () => {
    for (const next of [
      "/",
      "/dashboard",
      "https://evil.example/oauth/consent?authorization_id=abc123DEF",
      "//evil.example/oauth/consent?authorization_id=abc123DEF",
      "/oauth/consent?authorization_id=abc123DEF&next=https://evil.example",
      "/oauth/consent?authorization_id=short",
      "/oauth/consent",
      null,
      undefined,
    ]) {
      expect(isConsentReturnPath(next)).toBe(false);
    }
  });

  it("checks an authorization id's shape", () => {
    expect(isAuthorizationId("abc123DEF_-xyz")).toBe(true);
    expect(isAuthorizationId("../../etc")).toBe(false);
    expect(isAuthorizationId("")).toBe(false);
  });
});
