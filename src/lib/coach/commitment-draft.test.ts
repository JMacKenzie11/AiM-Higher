import { describe, it, expect } from "vitest";
import { COMMITMENT_DRAFT_BLOCK, COMMITMENT_DRAFT_TAG, parseCommitmentDraft } from "./commitment-draft";
import { OUTPUT_CARD_BY_TAG } from "@/lib/practices/output-cards";
import { findBannedPhrases } from "@/lib/voice/banned";

describe("parseCommitmentDraft", () => {
  it("reads a whole draft", () => {
    expect(parseCommitmentDraft('{"description": "Ask the team what made it work", "due_date": null}')).toEqual({
      description: "Ask the team what made it work",
      dueDate: null,
    });
    expect(parseCommitmentDraft('{"description": "Ship it", "due_date": "2026-10-05"}')).toEqual({
      description: "Ship it",
      dueDate: "2026-10-05",
    });
  });

  it("is null while the block is still arriving, or when it is not a draft", () => {
    expect(parseCommitmentDraft('{"description": "Ask the')).toBeNull();
    expect(parseCommitmentDraft('{"description": "  "}')).toBeNull();
    expect(parseCommitmentDraft("[1, 2]")).toBeNull();
  });

  it("drops a due date that is not a date, leaving it due by the next meeting", () => {
    expect(parseCommitmentDraft('{"description": "Ship it", "due_date": "next Friday"}')?.dueDate).toBeNull();
  });
});

describe("the draft block", () => {
  it("is shown as the draft card", () => {
    expect(OUTPUT_CARD_BY_TAG[COMMITMENT_DRAFT_TAG]).toBe("CommitmentDraftCard");
  });

  it("carries an example that parses, and breaks no voice rule", () => {
    const example = COMMITMENT_DRAFT_BLOCK.match(/```commitment\n([\s\S]*?)\n```/)?.[1] ?? "";
    expect(parseCommitmentDraft(example)).not.toBeNull();
    expect(findBannedPhrases(COMMITMENT_DRAFT_BLOCK)).toEqual([]);
  });

  it("says the save is theirs and only after a yes", () => {
    expect(COMMITMENT_DRAFT_BLOCK).toMatch(/only after they say yes/);
    expect(COMMITMENT_DRAFT_BLOCK).toMatch(/never say it is saved/);
  });
});
