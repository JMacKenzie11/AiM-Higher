import { splitSentences } from "./sentences";

// Two questions asked as one.
//
// "How's the margin model coming, and did the supplier pricing data
// you need actually show up?" came out of a prompt that says "then
// one question". One question mark, two things to answer, and the
// reader answers whichever is easier.
//
// ---- WHAT IT MATCHES --------------------------------------------
//
// Only the unambiguous shape: a sentence that ends in a question mark,
// OPENS as a question, and has ", and" followed by a word that opens
// a second one (did, is, what, who...). The comma matters. "How did
// you and Ray split it?" joins two people, not two questions, and
// "What would it take to finish the model and send it?" joins two
// verbs. Neither has the comma, neither is flagged.
//
// Narrow on purpose. A detector that misfires trains everyone to
// ignore it, and a question this shape misses is left to the prompt.

const OPENS_A_QUESTION =
  /^(?:how|what|why|when|where|who|which|did|do|does|is|are|was|were|has|have|had|can|could|will|would|should)(?:['’](?:s|re|ve|d|ll))?\b/i;

const SECOND_QUESTION =
  /,\s+and\s+(?:how|what|why|when|where|who|which|did|do|does|is|are|was|were|has|have|had|can|could|will|would|should)(?:['’](?:s|re|ve|d|ll))?\b/i;

export function findJoinedQuestions(text: string): string[] {
  return splitSentences(text).filter(
    (s) =>
      s.endsWith("?") && OPENS_A_QUESTION.test(s) && SECOND_QUESTION.test(s)
  );
}

export function joinedQuestionRetryInstruction(sentences: readonly string[]): string {
  return (
    `This asks two questions as one: ${sentences
      .map((s) => `"${s}"`)
      .join(", ")}. Ask one question. Keep the one that matters more and ` +
    `drop the other.`
  );
}
