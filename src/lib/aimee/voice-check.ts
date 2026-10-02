import { findBannedPhrases, retryInstruction } from "@/lib/voice/banned";
import { findUnsupportedQuotes, quoteRetryInstruction } from "@/lib/voice/quotes";
import { splitSentences } from "@/lib/voice/sentences";

// THE VOICE CHECK: EVERY RULE AN AIMEE REPLY IS HELD TO, IN ONE PLACE
// (coaching principles project, part 2; Jason, 2026-10-02).
//
// It replaces four lists that had grown apart: the generated opener's
// (guide/opener-checks.ts), the debrief reply's (guide/reply-checks.ts),
// the first plain reply's (coach/first-reply-checks.ts) and the one
// ordinary replies were counted against (aimee/rule-breaks.ts). The same
// rule had three spellings in them ("instead of" and "X instead of Y"),
// "rather than" was matched two ways, and a rule added to one list
// reached no other.
//
// So each rule is written once, here, and the route uses it two ways:
//
//   SENT BACK   a held-back turn (an opener, a debrief reply, the first
//               plain reply) is checked against its own short list
//               (SENT_BACK) and sent back once, naming what was wrong.
//               Those lists are exactly what each turn was sent back
//               for before this file, plus the one-question rule for
//               openers, which the principles hold every reply to.
//
//   COUNTED     every reply shown, streamed or held back, is checked
//               against every rule and the ones still broken are
//               counted in voice_rule_breaks (0244). That is how a rule
//               earns a place on a SENT_BACK list: from a week of
//               figures, never a guess (Jason, 2026-09-29). The three
//               added from the principles comparison (graded them, a
//               choice question, announced the next move) start here.
//
// A rule's name is what voice_rule_breaks stores and `npm run
// aimee:uptake` groups by, so a name is never changed once shipped.
//
// Aimee's own words only. A quote is what somebody said: it is left
// out of every rule here, and checked against the transcript instead
// where there is one ("invented quote").

export type CheckContext = {
  // The person's message this reply answers ("repeated their harsh word").
  userText?: string;
  // What was said in the meeting, for a debrief ("invented quote"). Empty
  // or missing skips that rule rather than calling every quote invented.
  transcript?: string;
  // From the strength check (coach/strength-check.ts), a model call the
  // route makes for a first reply only. Null or missing: nothing skipped.
  skippedStrength?: string | null;
};

// One broken rule and the words that broke it. The words go into the
// retry, which the model reads; never into a log or a table, which
// carry rule names only, because coaching is private.
export type Fault = { rule: string; found: string[] };

type Rule = {
  check: (text: string, ctx: CheckContext) => Fault[];
  // The retry's sentence for this rule's faults.
  fix: (faults: Fault[]) => string;
};

const quoted = (found: readonly string[]) => found.map((f) => `"${f}"`).join(", ");

export function outsideQuotes(text: string): string {
  return text.replace(/["“][^"”]*["”]/g, '""');
}

function questions(text: string): string[] {
  return (outsideQuotes(text).match(/[^.?!\n]*\?/g) ?? []).map((q) => q.trim()).filter(Boolean);
}

function statements(text: string): string[] {
  return splitSentences(outsideQuotes(text)).filter((s) => !s.endsWith("?"));
}

function firstSentence(text: string): string {
  return text.trim().split(/(?<=[.?!])\s|\n/)[0] ?? "";
}

// A rule that is one pattern over Aimee's own words.
function pattern(name: string, re: RegExp, fix: string, over: (text: string) => string[] = (t) => [outsideQuotes(t)]): Rule {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return {
    check: (text) => {
      const found = over(text).flatMap((part) => [...part.matchAll(global)].map((m) => m[0].trim()));
      return found.length > 0 ? [{ rule: name, found }] : [];
    },
    fix: () => fix,
  };
}

// ---- The rules --------------------------------------------------

// The banned list (voice/banned.ts), each phrase its own rule, named by
// its label as before.
const banned: Rule = {
  check: (text) => {
    const byPhrase = new Map<string, string[]>();
    for (const h of findBannedPhrases(outsideQuotes(text))) {
      byPhrase.set(h.phrase, [...(byPhrase.get(h.phrase) ?? []), h.context]);
    }
    return [...byPhrase].map(([rule, found]) => ({ rule, found }));
  },
  fix: (faults) => retryInstruction(faults.map((f) => ({ phrase: f.rule, context: "" }))),
};

// Her name at the start (Jason, 2026-09-29). The panel and the page
// already say who she is.
const introducedHerself = pattern(
  "introduced herself",
  /^\s*(?:(?:hi|hello|hey)[,!.]?\s+)?(?:i(?:'|’)m|i am)\s+aimee\b/i,
  "You opened with your name. The page already says who you are; leave it out.",
  (t) => [t]
);

// "That's a shift worth paying attention to, especially from..." Any
// opening That's, and any opening Okay (Jason, 2026-09-30).
const startedWithThats = pattern(
  "started with That's",
  /^\s*that(?:'|’)s\b/i,
  'You started with "That\'s". Say the acknowledgement differently, in one short sentence that fits what they said, without "That\'s" or "especially".',
  (t) => [t]
);
const startedWithOkay = pattern(
  "started with Okay",
  /^\s*(?:okay|ok)\b/i,
  'You started with "Okay". Start with something that fits what they said.',
  (t) => [t]
);

// "What does it actually look like?" reads as doubting them.
const actuallyInQuestion = pattern(
  "actually in the question",
  /\bactually\b/i,
  'Your question used "actually". Leave it out; it sounds as if you doubt them.',
  questions
);

// More than one question, or two asks joined in one: "..., and how long
// has this...?", "..., or is it not clear...?" (principles: "Ask one
// question at a time").
const JOINED_ASKS =
  /,?\s\b(?:and|or)\s+(?:what|how|why|when|who|where|which|is|are|was|were|do|does|did|have|has|can|could|would|should|will)\b/i;
const moreThanOneQuestion: Rule = {
  check: (text) => {
    const qs = questions(text);
    const found = qs.length > 1 ? qs : qs.filter((q) => JOINED_ASKS.test(q));
    return found.length > 0 ? [{ rule: "more than one question", found }] : [];
  },
  fix: (faults) => `You asked more than one thing (${quoted(faults[0].found)}). Ask one open question, about one thing.`,
};

// A question that offers a choice or a list to pick from: "Was it this,
// or that?", "Materials, labour, rework, or something else?" (principles:
// a choice asks two things). Counted, not sent back, until the figures
// say how often it fires on a question that offers no choice.
//
// Not a choice: "or so", "more or less", "whether or not", and a count
// ("one or two", "two or three").
const NOT_A_CHOICE = /\b(?:or so|more or less|whether or not|(?:one|two|three|four|a few) or (?:two|three|four|five|more))\b/gi;
const choiceQuestion: Rule = {
  check: (text) => {
    const found = questions(text).filter((q) => /\bor\b/i.test(q.replace(NOT_A_CHOICE, "")));
    return found.length > 0 ? [{ rule: "a choice question", found }] : [];
  },
  fix: (faults) =>
    `Your question offered a choice (${quoted(faults[0].found)}). Ask one open question and let them say what it is, without options to pick from.`,
};

// Marking what they said, decided or asked as good (principles:
// "Reflect without grading"). "Good move." "That's a solid move."
// "Good place to look." "Exactly the kind of move that..." Statements
// only: "Is that the right call?" asks rather than grades.
const GRADED =
  /^(?:(?:that|this|it)(?:'|’)?s\s+|(?:that|this|it) is\s+)?(?:a\s+|an\s+)?(?:really\s+|very\s+)?(?:good|great|smart|solid|strong|excellent|wise|nice|perfect|exactly right)\b(?!\s+(?:with|at|for)\b)|\b(?:good|great|smart|solid|strong|clean|wise|useful|helpful|right)\s+(?:move|instinct|call|idea|question|catch|plan|step|thinking|observation|insight|point|place to (?:look|start)|thing to (?:ask|be asking|notice|look at))\b|\bexactly the (?:kind of|right)\b|\byou(?:'|’)re (?:exactly |absolutely )?right\b/i;
const gradedThem: Rule = {
  check: (text) => {
    const found = statements(text).filter((s) => GRADED.test(s));
    return found.length > 0 ? [{ rule: "graded them", found }] : [];
  },
  fix: (faults) =>
    `You graded what they said (${quoted(faults[0].found)}). Say back what you heard in your own words, without calling it good, right, smart or solid.`,
};

// Saying what she is about to do instead of doing it: "Before we get
// into the script, I want to name this plainly". Banned in the voice
// rules (coach/voice-rules.ts, "Never meta-narrate"); counted here.
const announcedTheNextMove = pattern(
  "announced the next move",
  /\b(?:before we (?:get|go|build|script|start|shape|move|dive|work)|i want to (?:name|check|flag|be clear|start|make sure)|with that said|the first thing i want)\b/i,
  "You announced what you were about to do. Leave that out and do it."
);

// Setting what is against something else (Jason, 2026-09-29/30). "X
// instead of Y" is on the banned list. "Rather than" also split: "He'd
// rather carry it himself than hand it off".
const ratherThan = pattern(
  "rather than",
  /\brather\b[^.?!]{0,60}?\bthan\b/i,
  'Leave out "rather than"; say what is, without setting it against something else.'
);
// The banned list's own "X instead of Y" pattern is narrower than this
// (it wants something after "of"); the first reply was sent back for
// any "instead of" (2026-09-30), so it keeps its own. Same name, so a
// reply breaking both is counted once.
const insteadOf = pattern(
  "X instead of Y",
  /\binstead\s+of\b/i,
  'Leave out "instead of"; say what is, without setting it against something else.'
);
const notJust = pattern(
  "not just",
  /\bnot\s+just\b/i,
  'Leave out "not just"; say what is, without setting it against something else.'
);

// Reassurance by denying the opposite. Narrow on purpose: a pattern
// that fires on ordinary sentences would send good replies back.
const affirmingByDenial = pattern(
  "affirming by denial",
  /\b(?:nobody|no one|no-one)\s+(?:had|meant|was)\s+(?:a\s+)?(?:bad|ill|wrong)\b[^.?!]*|\b(?:that|this|it)(?:'s|’s|\s+is|\s+was)\s+not\s+(?:a\s+)?(?:small|little|minor|nothing)\b[^.?!]*|\bthis\s+(?:isn't|isn’t|is\s+not)\s+about\s+blame\b[^.?!]*/i,
  "You reassured by denying the opposite. Say what is true, in plain words."
);

// A quote nobody said, checked against the meeting transcript.
const inventedQuote: Rule = {
  check: (text, ctx) => {
    if (!ctx.transcript) return [];
    const found = findUnsupportedQuotes(text, ctx.transcript).map((q) => q.quote);
    return found.length > 0 ? [{ rule: "invented quote", found }] : [];
  },
  fix: (faults) => quoteRetryInstruction(faults[0].found.map((quote) => ({ quote }))),
};

// A stock phrase in the first sentence, the ones seen repeating across
// replies (Jason, 2026-09-30). Counting a repeat across replies would
// mean keeping their words, which voice_rule_breaks never does, so the
// list names them. Add one when the figures or a transcript show it.
const STOCK_OPENINGS: ReadonlyArray<[string, RegExp]> = [
  ["is real", /\bis real\b/i],
  ["worth paying attention to", /\bworth paying attention to\b/i],
  ["a lot to carry", /\ba lot to carry\b/i],
];
const stockOpening: Rule = {
  check: (text) => {
    const opening = outsideQuotes(firstSentence(text));
    return STOCK_OPENINGS.filter(([, re]) => re.test(opening)).map(([name]) => ({ rule: `stock opening: ${name}`, found: [name] }));
  },
  fix: (faults) => `Your first sentence used a stock phrase (${quoted(faults.flatMap((f) => f.found))}). Say it in words that fit what they told you.`,
};

// Their harsh word said back to them ("What does 'awful to the ops
// team' look like?"). Quoted or not: quoting it is the slip.
const HARSH_WORDS =
  /\b(?:terrible|useless|hopeless|awful|horrible|lazy|incompetent|pathetic|worthless|clueless|stupid|idiot(?:ic)?|a disaster|a nightmare)\b/gi;
const repeatedHarshWord: Rule = {
  check: (text, ctx) => {
    const theirs = new Set((ctx.userText?.match(HARSH_WORDS) ?? []).map((w) => w.toLowerCase()));
    const found = [...new Set((text.match(HARSH_WORDS) ?? []).map((w) => w.toLowerCase()))].filter((w) => theirs.has(w));
    return found.length > 0 ? [{ rule: "repeated their harsh word", found }] : [];
  },
  fix: (faults) => `You repeated their word (${quoted(faults[0].found)}). Ask about it in neutral words.`,
};

// A strength they named that the reply skipped (strength-check.ts).
const skippedStrength: Rule = {
  check: (_text, ctx) => (ctx.skippedStrength ? [{ rule: "skipped a named strength", found: [ctx.skippedStrength] }] : []),
  fix: (faults) =>
    `They named a strength ("${faults[0].found[0]}"). Acknowledge it first, then ask about the difficulty in neutral words, without repeating any harsh word of theirs.`,
};

// ---- Which rules where ------------------------------------------

export type CheckedTurn = "opener" | "debrief reply" | "first reply";

// What each held-back turn is sent back for.
export const SENT_BACK: Record<CheckedTurn, readonly Rule[]> = {
  opener: [banned, moreThanOneQuestion],
  "debrief reply": [inventedQuote, affirmingByDenial, banned],
  "first reply": [
    introducedHerself,
    startedWithThats,
    startedWithOkay,
    actuallyInQuestion,
    moreThanOneQuestion,
    ratherThan,
    insteadOf,
    notJust,
    skippedStrength,
  ],
};

// What every reply shown is counted against. Most serious first, which
// is the order a retry names them in.
export const COUNTED: readonly Rule[] = [
  inventedQuote,
  introducedHerself,
  skippedStrength,
  gradedThem,
  moreThanOneQuestion,
  choiceQuestion,
  announcedTheNextMove,
  affirmingByDenial,
  repeatedHarshWord,
  startedWithThats,
  startedWithOkay,
  actuallyInQuestion,
  stockOpening,
  ratherThan,
  insteadOf,
  notJust,
  banned,
];

export type VoiceCheck = {
  faults: Fault[];
  // The names, for the log and voice_rule_breaks.
  rules: string[];
  // The rules with the words that broke them, for a model to read: a
  // generator's own list of what to fix (guide/headline.ts).
  describe: string;
  // Sent back as the next turn, so it asks for a replacement, never a
  // correction to answer: a note answered as a correction reached a
  // champion as "Fair. Let me redo that part." (#358).
  retry: string;
};

export function checkVoice(text: string, rules: readonly Rule[], ctx: CheckContext = {}): VoiceCheck {
  const faults: Fault[] = [];
  const fixes: string[] = [];
  for (const rule of rules) {
    const found = rule.check(text, ctx).filter((f) => !faults.some((g) => g.rule === f.rule));
    if (found.length === 0) continue;
    faults.push(...found);
    fixes.push(rule.fix(found));
  }
  return {
    faults,
    rules: faults.map((f) => f.rule),
    describe: faults.map((f) => `${f.rule} (${quoted(f.found)})`).join("; "),
    retry:
      `${fixes.join(" ")} Write the whole reply again, exactly as they will read it. ` +
      `It replaces what you wrote, and they never saw that, so write it as if for ` +
      `the first time: no acknowledgement of this note, no preamble, and never ` +
      `mention a previous version.`,
  };
}
