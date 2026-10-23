import { describe, it, expect } from "vitest";
import { checkTurn, conversationInput, exchangesIn, notesWithAnswer } from "./conversation";

describe("the person's words in the notes", () => {
  it("adds a question's heading once, and a follow-up's answer runs on beneath it", () => {
    let body = notesWithAnswer("", 0, "Last spring, when I rebuilt the quoting sheet.");
    expect(body).toBe("1. Best work\nLast spring, when I rebuilt the quoting sheet.");
    body = notesWithAnswer(body, 0, "  I knew every part number by heart.  ");
    body = notesWithAnswer(body, 1, "The inbox.");
    expect(body).toBe("1. Best work\nLast spring, when I rebuilt the quoting sheet.\nI knew every part number by heart.\n\n2. What gets in the way\nThe inbox.");
    expect(notesWithAnswer(body, 2, "   ")).toBe(body);
  });

  it("keeps what the lead wrote before, and reads the answers back by heading", () => {
    const body = notesWithAnswer("Quiet at first.", 4, "Walking the floor with new customers.");
    expect(body).toBe("Quiet at first.\n\n5. Where the hours would go\nWalking the floor with new customers.");
    expect(exchangesIn(body)).toEqual([{ question: 4, said: "Walking the floor with new customers." }]);
    expect(exchangesIn("1. Best work\n\n2. What gets in the way\nThe inbox.\nAnd the phone.")).toEqual([{ question: 1, said: "The inbox.\nAnd the phone." }]);
  });

  it("tells the helper the question and what was said, by number", () => {
    const input = JSON.parse(conversationInput(1, [{ question: 0, said: "Quoting" }], null));
    expect(input.question_being_asked.number).toBe(2);
    expect(input.what_they_have_said).toEqual([{ question: 1, said: "Quoting" }]);
    expect(input.their_role).toBe("Team member");
  });
});

describe("what the helper may show", () => {
  it("keeps a plain follow-up and the two short fields", () => {
    expect(
      checkTurn({ follow_up: "What did you bring to that quote that someone newer would miss?", move_on: false, peak_experience: "Rebuilding the quoting sheet", redeploy_wish: "" })
    ).toEqual({ followUp: "What did you bring to that quote that someone newer would miss?", moveOn: false, peakExperience: "Rebuilding the quoting sheet", redeployWish: null });
  });

  it("drops a follow-up that pries into private life, is not a question, or breaks the voice rules, and moves on", () => {
    expect(checkTurn({ follow_up: "Is your divorce affecting your work?", move_on: false }).followUp).toBeNull();
    expect(checkTurn({ follow_up: "Tell me more about that.", move_on: false })).toMatchObject({ followUp: null, moveOn: true });
    expect(checkTurn({ follow_up: "Can we dive into that a little more?", move_on: false }).followUp).toBeNull();
  });

  it("survives a malformed answer", () => {
    expect(checkTurn(null)).toEqual({ followUp: null, moveOn: true, peakExperience: null, redeployWish: null });
  });
});
