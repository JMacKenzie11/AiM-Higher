import { describe, it, expect } from "vitest";
import {
  isUntouchedSeed,
  seedAdoptionWarning,
  type TargetState,
} from "./distribution";

// Adopting a seeded copy, and refusing anything else.
//
// The refusal this relaxes exists to stop a push overwriting an
// agent somebody authored on their own instance. What it could not
// tell apart was the five agents migration 0226 seeds on EVERY
// instance, which look locally authored and are not.

function state(over: Partial<TargetState> = {}): TargetState {
  return {
    agentId: "a1",
    managedFrom: null,
    liveVersionNumber: null,
    versionCount: 0,
    hasDraft: false,
    ...over,
  };
}

describe("isUntouchedSeed", () => {
  it("adopts a seeded copy nobody has published", () => {
    // Exactly the shape measured on the client instance before this
    // was written: five rows, zero versions, no pointers.
    expect(isUntouchedSeed(state())).toBe(true);
  });

  it("refuses a copy with a published version", () => {
    expect(isUntouchedSeed(state({ versionCount: 1 }))).toBe(false);
  });

  it("refuses a copy that is live", () => {
    // Belt and braces with the count: a live pointer without a
    // version row would mean something is wrong, and wrong is not a
    // state to adopt in.
    expect(isUntouchedSeed(state({ liveVersionNumber: 2 }))).toBe(false);
  });

  it("refuses a copy with a draft in progress", () => {
    // Unpublished, so nobody is running it, but somebody is mid-edit
    // and a push would silently take the agent out from under them.
    expect(isUntouchedSeed(state({ hasDraft: true }))).toBe(false);
  });

  it("refuses a copy with versions even when nothing is live", () => {
    // Published then unpublished. The work still happened.
    expect(
      isUntouchedSeed(state({ versionCount: 3, liveVersionNumber: null }))
    ).toBe(false);
  });
});

describe("seedAdoptionWarning", () => {
  const warning = seedAdoptionWarning("prepare-a-hard-conversation", 3);

  it("says what the instance runs now and what it would run", () => {
    expect(warning).toContain("prepare-a-hard-conversation");
    expect(warning).toContain("built into the code");
    expect(warning).toContain("version 3");
  });

  it("never mentions admins", () => {
    // The sentence this replaced said "local admins stop being able
    // to edit it". It named a class of person that does not exist —
    // there are only system admins — and after 0231 it described a
    // change that had already happened on every receiving instance.
    // A plan is read to decide whether to press Apply, so it has to
    // describe what Apply does, not what the schema already did.
    expect(warning).not.toMatch(/admin/i);
  });
});
