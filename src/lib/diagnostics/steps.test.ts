import { describe, it, expect } from "vitest";
import { DIAGNOSTIC_STEPS, INTERVIEWS_SHOWN, isStep, stepAfter, stepForStatus } from "./steps";

// The people interviews are hidden (Jason, 2026-10-29). These hold
// while they are; flipping INTERVIEWS_SHOWN brings the steps back.
describe.skipIf(INTERVIEWS_SHOWN)("the steps with the interviews hidden", () => {
  it("leaves out the survey and the conversations", () => {
    expect(DIAGNOSTIC_STEPS.map((s) => s.key)).toEqual(["preflight", "kickoff", "build", "readout"]);
    expect(isStep("survey")).toBe(false);
    expect(stepAfter("kickoff")).toBe("build");
  });

  it("opens a diagnostic left on a hidden step on Build", () => {
    expect(stepForStatus("survey")).toBe("build");
    expect(stepForStatus("conversations")).toBe("build");
    expect(stepForStatus("kickoff")).toBe("kickoff");
    expect(stepForStatus("decided")).toBe("readout");
  });
});
