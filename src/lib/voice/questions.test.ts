import { describe, it, expect } from "vitest";
import { findJoinedQuestions, joinedQuestionRetryInstruction } from "./questions";

describe("findJoinedQuestions", () => {
  it("catches the real opener's question", () => {
    const q =
      "How's the margin model coming, and did the supplier pricing data you need actually show up?";
    expect(findJoinedQuestions(`You're carrying two pieces now. ${q}`)).toEqual([q]);
  });

  it("catches it with a curly apostrophe", () => {
    expect(findJoinedQuestions("How’s it going, and is Ray on board?")).toHaveLength(1);
  });

  // The misfires that would make it worthless.
  it("leaves two people, two verbs and one question alone", () => {
    expect(findJoinedQuestions("How did you and Ray split it?")).toEqual([]);
    expect(
      findJoinedQuestions("What would it take to finish the model and send it?")
    ).toEqual([]);
    expect(findJoinedQuestions("Who tells the crew?")).toEqual([]);
    // A statement with ", and did" is not a question at all.
    expect(findJoinedQuestions("They met, and did the work.")).toEqual([]);
  });

  it("does not open on a statement that ends in a question", () => {
    expect(
      findJoinedQuestions("The team named an owner, and what made that possible?")
    ).toEqual([]);
  });

  it("tells the retry to keep one", () => {
    expect(joinedQuestionRetryInstruction(["A, and did B?"])).toMatch(/Ask one question/);
  });
});
