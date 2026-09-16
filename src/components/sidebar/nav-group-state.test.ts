import { describe, it, expect } from "vitest";
import {
  DEFAULT_COLLAPSED_GROUPS,
  NO_GROUPS_COLLAPSED,
  parseCollapsedGroups,
  serializeCollapsedGroups,
} from "./nav-group-state";

// The rule that keeps "never touched it" and "opened everything on
// purpose" apart.
//
// Without that distinction the feature eats itself: Guide HQ and
// Portfolio start collapsed, somebody opens them, the collapsed set
// empties, the cookie clears, and the next page load reads "no
// cookie" as "new user" and closes them again. Which is exactly the
// "continually have to reopen it" this was built to avoid.

describe("parseCollapsedGroups", () => {
  it("gives a new user the defaults", () => {
    expect(parseCollapsedGroups(undefined)).toEqual([
      ...DEFAULT_COLLAPSED_GROUPS,
    ]);
  });

  it("treats a stale empty cookie as no preference", () => {
    // What the previous encoding left behind when it cleared the
    // cookie. The defaults are the better answer for it.
    expect(parseCollapsedGroups("")).toEqual([...DEFAULT_COLLAPSED_GROUPS]);
    expect(parseCollapsedGroups("   ")).toEqual([...DEFAULT_COLLAPSED_GROUPS]);
  });

  it("respects an explicit nothing-collapsed", () => {
    // THE CLAIM THAT MATTERS. Somebody opened every group; that is a
    // preference, not an absence of one.
    expect(parseCollapsedGroups(NO_GROUPS_COLLAPSED)).toEqual([]);
  });

  it("reads a list back", () => {
    expect(parseCollapsedGroups("Guide HQ,Disciplines")).toEqual([
      "Guide HQ",
      "Disciplines",
    ]);
  });

  it("tolerates spacing and empty entries", () => {
    expect(parseCollapsedGroups(" Guide HQ , ,Portfolio ")).toEqual([
      "Guide HQ",
      "Portfolio",
    ]);
  });
});

describe("serializeCollapsedGroups", () => {
  it("writes the sentinel rather than an empty string", () => {
    expect(serializeCollapsedGroups([])).toBe(NO_GROUPS_COLLAPSED);
  });

  it("writes a list", () => {
    expect(serializeCollapsedGroups(["Guide HQ", "Portfolio"])).toBe(
      "Guide HQ,Portfolio"
    );
  });

  it("round-trips, which is the whole contract", () => {
    for (const set of [[], ["Guide HQ"], ["Guide HQ", "Disciplines"]]) {
      expect(parseCollapsedGroups(serializeCollapsedGroups(set))).toEqual(set);
    }
  });

  it("round-trips the defaults without turning them into no-preference", () => {
    // A user who collapses exactly the default pair must read back as
    // having collapsed them, not as never having chosen.
    const s = serializeCollapsedGroups(DEFAULT_COLLAPSED_GROUPS);
    expect(s).not.toBe(NO_GROUPS_COLLAPSED);
    expect(parseCollapsedGroups(s)).toEqual([...DEFAULT_COLLAPSED_GROUPS]);
  });
});
