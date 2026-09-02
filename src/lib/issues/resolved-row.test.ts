import { describe, it, expect } from "vitest";
import { resolvedCommitmentCell } from "./resolved-row";

// Pins the Commitment-column rule for the Resolved issues table.
// The case that matters: an issue closed by the meeting-summary
// "Resolved in meeting" shortcut never gets a commitment, so it used
// to render a bare em-dash — indistinguishable from an issue resolved
// some other way with nothing attached.

describe("resolvedCommitmentCell", () => {
  it("shows the commitment text when one exists", () => {
    expect(
      resolvedCommitmentCell({
        commitmentDescription: "Draft the new date-code spec",
        resolvedInMeeting: false,
      })
    ).toEqual({ kind: "commitment", text: "Draft the new date-code spec" });
  });

  it("says 'resolved in meeting' when the shortcut closed it and no commitment landed", () => {
    expect(
      resolvedCommitmentCell({
        commitmentDescription: null,
        resolvedInMeeting: true,
      })
    ).toEqual({ kind: "in-meeting" });
  });

  it("falls back to empty when there is no commitment and no provenance", () => {
    // An issue resolved through the normal /issues flow without a
    // commitment ever being attached. We know nothing about how it
    // closed, so claiming the button was used would be a lie.
    expect(
      resolvedCommitmentCell({
        commitmentDescription: null,
        resolvedInMeeting: false,
      })
    ).toEqual({ kind: "empty" });
  });

  it("treats an absent flag as empty, so the UI is safe before migration 0162", () => {
    // getIssuesPageData selects "*", so until the column exists the
    // field is undefined. That must read as "unknown", never as true.
    expect(
      resolvedCommitmentCell({
        commitmentDescription: null,
        resolvedInMeeting: undefined,
      })
    ).toEqual({ kind: "empty" });
  });

  it("prefers a real commitment over the provenance label", () => {
    // Defensive: the shortcut doesn't create a commitment, but if one
    // were linked afterwards the actual work is the more useful thing
    // to show.
    expect(
      resolvedCommitmentCell({
        commitmentDescription: "Follow up with the consultant",
        resolvedInMeeting: true,
      })
    ).toEqual({ kind: "commitment", text: "Follow up with the consultant" });
  });

  it("treats a whitespace-only description as no commitment", () => {
    expect(
      resolvedCommitmentCell({
        commitmentDescription: "   ",
        resolvedInMeeting: true,
      })
    ).toEqual({ kind: "in-meeting" });
  });

  it("trims the description it returns", () => {
    expect(
      resolvedCommitmentCell({
        commitmentDescription: "  Ship the fix  ",
        resolvedInMeeting: false,
      })
    ).toEqual({ kind: "commitment", text: "Ship the fix" });
  });
});
