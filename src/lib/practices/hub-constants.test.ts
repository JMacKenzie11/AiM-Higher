import { describe, it, expect } from "vitest";
import {
  mergeAccessPredicates,
  FUNCTION_LEAD_PREDICATE,
} from "./hub-constants";

// The access drawer renders ONE checkbox and the agents table holds
// a list. That gap is the bug this function exists for: a save that
// wrote the checkbox's answer alone would quietly revoke every
// predicate the drawer does not draw.
describe("mergeAccessPredicates", () => {
  it("writes the checkbox's answer", () => {
    expect(mergeAccessPredicates([], true)).toEqual([FUNCTION_LEAD_PREDICATE]);
    expect(mergeAccessPredicates([FUNCTION_LEAD_PREDICATE], false)).toEqual([]);
  });

  it("keeps a predicate the drawer does not model", () => {
    // An admin opening an agent's access drawer, ticking nothing and
    // pressing Save must not take away access they were never shown a
    // control for.
    expect(
      mergeAccessPredicates(["some_other_predicate"], false)
    ).toEqual(["some_other_predicate"]);
  });

  it("keeps it while also setting the one it does model", () => {
    expect(mergeAccessPredicates(["some_other_predicate"], true)).toEqual([
      FUNCTION_LEAD_PREDICATE,
      "some_other_predicate",
    ]);
  });

  it("does not duplicate the modelled one when it is already there", () => {
    expect(
      mergeAccessPredicates(
        [FUNCTION_LEAD_PREDICATE, "some_other_predicate"],
        true
      )
    ).toEqual([FUNCTION_LEAD_PREDICATE, "some_other_predicate"]);
  });

  it("treats a null column as empty", () => {
    expect(mergeAccessPredicates(null, false)).toEqual([]);
    expect(mergeAccessPredicates(undefined, true)).toEqual([
      FUNCTION_LEAD_PREDICATE,
    ]);
  });
});
