import { describe, it, expect } from "vitest";
import { scopedCompanyIdForProfile } from "./scope";

// The scope cookie belongs to one profile.
//
// FOUND ON PRODUCTION 2026-09-14. A newly created portfolio_admin
// signed in and landed inside a company's dashboard without pressing a
// scope-in control, and with no row in portfolio_admin_events to say
// they had entered. The cookie was a previous session's: path=/, eight
// hours, and cleared by exactly two code paths — neither of which was
// signing out or accepting an invite.
//
// These assertions are about the class, not the incident. A cookie
// issued to one profile must not resolve for another, whatever created
// the session and whichever clear() calls somebody remembers to add.

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CO = "33333333-3333-4333-8333-333333333333";

describe("scopedCompanyIdForProfile", () => {
  it("returns the company for the profile it was issued to", () => {
    expect(scopedCompanyIdForProfile(`${A}:${CO}`, A)).toBe(CO);
  });

  it("returns null for a different profile", () => {
    // The incident, in one line.
    expect(scopedCompanyIdForProfile(`${A}:${CO}`, B)).toBeNull();
  });

  it("refuses an unbound cookie written before the binding existed", () => {
    // A bare company id is exactly the shape this stops honouring.
    // The cost is one re-pick per operator, once.
    expect(scopedCompanyIdForProfile(CO, A)).toBeNull();
  });

  it("refuses an absent cookie", () => {
    expect(scopedCompanyIdForProfile(undefined, A)).toBeNull();
    expect(scopedCompanyIdForProfile("", A)).toBeNull();
  });

  it("refuses a malformed one rather than guessing", () => {
    expect(scopedCompanyIdForProfile(":", A)).toBeNull();
    expect(scopedCompanyIdForProfile(`:${CO}`, A)).toBeNull();
    expect(scopedCompanyIdForProfile(`${A}:`, A)).toBeNull();
  });

  it("does not match on a prefix", () => {
    // `A` is a prefix of `A-extra`. Splitting on the first colon and
    // comparing the whole left side is what makes this exact; a
    // startsWith would not be.
    expect(scopedCompanyIdForProfile(`${A}-extra:${CO}`, A)).toBeNull();
  });

  it("keeps a company id containing no colon intact", () => {
    // Split on the FIRST colon only, so the company id is whatever
    // follows, unexamined.
    expect(scopedCompanyIdForProfile(`${A}:${CO}`, A)).toBe(CO);
  });
});
