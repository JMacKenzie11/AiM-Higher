import { describe, it, expect } from "vitest";
import { findSessionOffer, parseSessionOffer, HANDOFF_SUMMARY_MAX } from "./session-offer-block";

// The offer block is read twice: by the card while it streams, and by
// the start action from the saved message. Both must agree on what an
// offer is, and the server must read the one the person saw.

describe("parseSessionOffer", () => {
  it("reads a session and a summary", () => {
    expect(parseSessionOffer('{"session": "prepare-a-hard-conversation", "summary": " Sam keeps missing it. "}')).toEqual({
      session: "prepare-a-hard-conversation",
      summary: "Sam keeps missing it.",
    });
  });

  it("is null while it arrives, or when it is not an offer", () => {
    expect(parseSessionOffer('{"session": "prepare-a-hard')).toBeNull();
    expect(parseSessionOffer('{"session": "x"}')).toBeNull();
    expect(parseSessionOffer('{"session": "x", "summary": "   "}')).toBeNull();
    expect(parseSessionOffer('{"session": "Not A Slug!", "summary": "s"}')).toBeNull();
    expect(parseSessionOffer("[]")).toBeNull();
  });

  it("holds the summary to the column's limit", () => {
    const long = "a".repeat(HANDOFF_SUMMARY_MAX + 50);
    expect(parseSessionOffer(JSON.stringify({ session: "x", summary: long }))?.summary).toHaveLength(HANDOFF_SUMMARY_MAX);
  });
});

describe("findSessionOffer", () => {
  it("finds the block in a saved reply", () => {
    const reply = 'That sounds hard. Want to work through it?\n\n```session_offer\n{"session": "ask-better-questions", "summary": "You have a review on Monday."}\n```';
    expect(findSessionOffer(reply)).toEqual({ session: "ask-better-questions", summary: "You have a review on Monday." });
  });

  it("takes the last block when there are two, the one the person saw last", () => {
    const reply =
      '```session_offer\n{"session": "a", "summary": "first"}\n```\nand\n```session_offer\n{"session": "b", "summary": "second"}\n```';
    expect(findSessionOffer(reply)?.session).toBe("b");
  });

  it("ignores other cards and plain replies", () => {
    expect(findSessionOffer('```commitment\n{"description": "x", "due_date": null}\n```')).toBeNull();
    expect(findSessionOffer("No offer here.")).toBeNull();
  });
});
