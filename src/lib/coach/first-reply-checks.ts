// THE FIRST REPLY OF A PLAIN AIMEE CONVERSATION, CHECKED BEFORE IT IS
// SHOWN (Jason, 2026-09-30).
//
// The instructions (general-preamble.ts) ask for a short acknowledgement
// and one open question, no name, no stock shape. On their own they held
// about half the time: in ten test replies, four opened "That's...",
// three of them with "especially", and three asked two things in one
// question. So the first reply is held back like a debrief reply, checked
// for exactly these, and sent back once with what was wrong. Later
// replies stream as before.
//
// Widened 2026-09-30 (Jason): any opening "That's" (not only with
// "especially"), any opening "Okay", and "actually" in the question
// ("What does it actually look like?"), which reads as doubting them.
// Then (Jason, 2026-09-30): "rather than", "instead of" and "not just",
// and a strength the person named but the reply skipped
// (strength-check.ts, which fills skippedStrength).

export type FirstReplyFaults = {
  introducedHerself: boolean;
  startsWithThats: boolean;
  startsWithOkay: boolean;
  actuallyInQuestion: boolean;
  questions: string[];
  contrasts: string[];
  skippedStrength: string | null;
};

const INTRODUCES_HERSELF = /^\s*(?:(?:hi|hello|hey)[,!.]?\s+)?(?:i(?:'|’)m|i am)\s+aimee\b/i;
// "That's a shift worth paying attention to, especially from..."
const STARTS_WITH_THATS = /^\s*that(?:'|’)s\b/i;
const STARTS_WITH_OKAY = /^\s*(?:okay|ok)\b/i;
const ACTUALLY = /\bactually\b/i;
const CONTRASTS: ReadonlyArray<[string, RegExp]> = [
  // Also split: "He'd rather carry it himself than hand it off" (reply 3).
  ["rather than", /\brather\b[^.?!]{0,60}?\bthan\b/i],
  ["instead of", /\binstead\s+of\b/i],
  ["not just", /\bnot\s+just\b/i],
];
const outsideQuotes = (text: string) => text.replace(/["“][^"”]*["”]/g, '""');
// A question that joins two asks: "..., and how long has this...?",
// "..., or is it not clear...?", "..., or what did they say?"
const JOINED_ASKS =
  /,?\s\b(?:and|or)\s+(?:what|how|why|when|who|where|which|is|are|was|were|do|does|did|have|has|can|could|would|should|will)\b/i;

function questionSentences(text: string): string[] {
  const outside = outsideQuotes(text);
  return (outside.match(/[^.?!\n]*\?/g) ?? []).map((q) => q.trim()).filter(Boolean);
}

export function checkFirstReply(text: string): FirstReplyFaults {
  const qs = questionSentences(text);
  const tooMany = qs.length > 1 ? qs : qs.filter((q) => JOINED_ASKS.test(q));
  return {
    introducedHerself: INTRODUCES_HERSELF.test(text),
    startsWithThats: STARTS_WITH_THATS.test(text),
    startsWithOkay: STARTS_WITH_OKAY.test(text),
    actuallyInQuestion: qs.some((q) => ACTUALLY.test(q)),
    questions: tooMany,
    contrasts: CONTRASTS.filter(([, re]) => re.test(outsideQuotes(text))).map(([name]) => name),
    skippedStrength: null,
  };
}

export function firstReplyFaultCount(f: FirstReplyFaults): number {
  return firstReplyRules(f).length;
}

// The rule names, for the log and for counting (0244's voice_rule_breaks).
export function firstReplyRules(f: FirstReplyFaults): string[] {
  return [
    ...(f.introducedHerself ? ["introduced herself"] : []),
    ...(f.startsWithThats ? ["started with That's"] : []),
    ...(f.startsWithOkay ? ["started with Okay"] : []),
    ...(f.actuallyInQuestion ? ["actually in the question"] : []),
    ...(f.questions.length > 0 ? ["more than one question"] : []),
    ...f.contrasts,
    ...(f.skippedStrength ? ["skipped a named strength"] : []),
  ];
}

export function describeFirstReplyFaults(f: FirstReplyFaults): string {
  return firstReplyRules(f).join("; ");
}

// Sent back as the next turn, so it asks for a replacement, never a
// correction to answer: a note answered as a correction reached a
// champion as "Fair. Let me redo that part." (#358).
export function firstReplyRetryInstruction(f: FirstReplyFaults): string {
  const what = [
    f.introducedHerself ? "You opened with your name. The page already says who you are; leave it out." : null,
    f.startsWithThats
      ? 'You started with "That\'s". Say the acknowledgement differently, in one short sentence that fits what they said, without "That\'s" or "especially".'
      : null,
    f.startsWithOkay ? 'You started with "Okay". Start with something that fits what they said.' : null,
    f.actuallyInQuestion ? 'Your question used "actually". Leave it out; it sounds as if you doubt them.' : null,
    f.questions.length > 0
      ? `You asked more than one thing (${f.questions.map((q) => `"${q}"`).join(", ")}). Ask one open question, about one thing.`
      : null,
    f.contrasts.length > 0
      ? `Leave out ${f.contrasts.map((c) => `"${c}"`).join(" and ")}; say what is, without setting it against something else.`
      : null,
    f.skippedStrength
      ? `They named a strength ("${f.skippedStrength}"). Acknowledge it first, then ask about the difficulty in neutral words, without repeating any harsh word of theirs.`
      : null,
  ].filter(Boolean);
  return (
    `${what.join(" ")} Write the whole reply again, exactly as they will read it. ` +
    `It replaces what you wrote, and they never saw that, so write it as if for ` +
    `the first time: no acknowledgement of this note, no preamble, and never ` +
    `mention a previous version.`
  );
}
