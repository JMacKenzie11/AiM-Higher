// Em dashes out of generated prose, deterministically.
//
// ---- WHY CODE AND NOT THE PROMPT -------------------------------
//
// The rule is in the prompt. It is in VOICE_CORE, it is the first
// line, and it is mandatory. The summariser broke it five times in
// one 12,000 character summary anyway, every time in the same
// shape: "**A value** — what happened."
//
// That is a formatting habit rather than a sentence the model chose
// to write, which is exactly the kind of thing a prompt is bad at
// suppressing and a string replace is perfect at. This project has
// the same finding recorded about dates: when the answer is
// mechanical, do it mechanically instead of asking the model again
// and more loudly.
//
// The prompt rule stays. It shapes the sentences the model plans;
// this catches what survives.
//
// ---- WHAT IT REPLACES THEM WITH --------------------------------
//
// Punctuation that reads right in that position, which depends on
// what surrounds the dash:
//
//   "**Bold** — text"      a label and its explanation   → colon
//   "word — word"          an aside mid-sentence          → comma
//   "text —"  /  "— text"  a dangling dash                → dropped
//
// Never a hyphen. "The crew - and Ray - had it done" is a worse
// sentence than either alternative, and it is the substitution
// people reach for first.

const EM = /[—–]/;

export function stripEmDashes(text: string): string {
  if (!EM.test(text)) return text;

  return (
    text
      // A bolded or italic label followed by its explanation. Colon.
      .replace(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)\s+[—–]\s+/g, "$1: ")
      // A list item's label followed by its explanation. Colon.
      .replace(/^(\s*[-*]\s+[^—–\n]{1,60}?)\s+[—–]\s+/gm, "$1: ")
      // A dash pair around an aside becomes a comma pair.
      .replace(/\s+[—–]\s+([^—–\n]{1,80}?)\s+[—–]\s+/g, ", $1, ")
      // Anything left between words becomes a comma.
      .replace(/(\S)\s+[—–]\s+(\S)/g, "$1, $2")
      // A dash hard against a word on both sides, as in a range or
      // a compound. Comma, with the spacing the sentence needs.
      .replace(/(\w)[—–](\w)/g, "$1, $2")
      // Dangling at either end of a line, which punctuates nothing.
      .replace(/\s*[—–]\s*$/gm, "")
      .replace(/^\s*[—–]\s*/gm, "")
      // A double space the replacements can leave behind.
      .replace(/([^\S\n]) +/g, "$1")
  );
}
