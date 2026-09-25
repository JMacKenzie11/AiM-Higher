// Does this text break the voice rules, and where?
//
// ---- WHY A CHECKER AND NOT JUST THE PROMPT ---------------------
//
// Same finding as the em dashes. The rules are in the prompt, first,
// marked mandatory; the model breaks them anyway, in small habitual
// ways rather than in whole sentences it chose. "What made that
// reframe LAND in the room" came out of a turn whose prompt banned
// "land" by name.
//
// Unlike the em dash, a banned WORD cannot be substituted safely
// from outside: "land" wants a different sentence, not a different
// character. So this reports rather than rewrites, and the caller
// decides — regenerate once where that is cheap, log where it is
// not.
//
// ---- WHAT IT LOOKS FOR -----------------------------------------
//
// The phrases whose presence is unambiguous. Deliberately NOT the
// whole banned list: "aim" and "gentle" are banned as metaphors for
// framing a conversation and are ordinary words elsewhere, and a
// checker that fires on "we aim to deliver Tuesday" would train
// everyone to ignore it. A narrow check people trust beats a wide
// one people switch off.

export type BannedHit = { phrase: string; context: string };

// Exported for the prompt guard (prompts-vs-banned.test.ts): no prompt
// may use a phrase its own checker bans.
export const PHRASES: readonly string[] = [
  // Generic LLM vocabulary.
  "delve",
  "dive in",
  "dive into",
  "dive deep",
  "unpack",
  "tease apart",
  "tease out",
  "circle back",
  "level-set",
  "level set",
  "touch base",
  "sync up",
  "game-changer",
  "game-changing",
  "seamless",
  "robust",
  "synergy",
  "synergize",
  "moves the needle",
  "at the end of the day",
  "it's worth noting",
  "in conclusion",
  "to summarize",
  "here's the thing",
  "the good news is",
  "the bad news is",
  "what I'm hearing is",
  "the real question is",
  "does that resonate",
  "does that land",
  "how does that sit with you",
  "let me know if that",
  "does that make sense",
  // Affirmation by denial.
  "not a small thing",
  "no small thing",
  "no small feat",
  "not nothing",
  "not an accident",
  "no accident",
  "not insignificant",
  "not trivial",
  "not uncommon",
  // The coaching metaphors this product has specifically ruled out.
  "hold space",
  "lean in",
  "meet them where they are",
  "sit with",
  "inner critic",
  "inner voice",
  // Sentence fragments. Checked as whole-string endings rather than
  // by parsing: a fragment is only detectable in general by knowing
  // what a sentence is, and these four are the ones this product
  // actually produces. They read as a text message, which is the
  // shape that makes generated copy sound generated.
  "five minutes?",
  "worth a look?",
  "sound good?",
  "thoughts?",
  "make sense?",
  // Aimee narrating her own machinery. "Headline" and "nudge" are
  // internal words for the line in the notification bar; a reader
  // who clicked it does not need it named back to them, and naming
  // it is the product talking about itself.
  "that headline",
  "the headline",
  "my headline",
  "the note i sent",
  "my note",
  "the notification",
  // "The room" as a stand-in for the people in it. "You were in the
  // room for that one" opened a debrief with a phrase that sounds
  // like attention and says nothing about who did what. Say the
  // meeting, the team, or the person.
  "the room",
  // "Quietly" as an intensifier. Banned in the rules since before
  // this checker existed, and it went straight through a generated
  // headline: "you quietly ran out three Tuesdays of conflict".
  "quietly",
];

// Some of these cannot be listed, only described.
//
// "Land" is the example that forced this. It is banned as a
// metaphor for whether a message is concrete, and it is an ordinary
// word otherwise: a plane lands, a contract lands, a punch lands.
// A literal list chased it and kept missing — "land in the room"
// was banned and "made that question land this time" walked
// straight past it, in a turn whose prompt names the word.
//
// So the metaphor is matched by its SHAPE: something being made to
// land, or a place where a thing lands. "The plane lands at four"
// does not match, and that is the whole point.
const PATTERNS: ReadonlyArray<[label: string, re: RegExp]> = [
  [
    "land (as a metaphor)",
    // Up to three words between the verb and "land", because the
    // thing being landed is usually named: "made that question
    // land", "helped the message land with the crew". The first
    // version allowed one word and missed the real case.
    /\b(?:made|make|makes|making|help(?:s|ed|ing)?)\s+(?:\w+\s+){0,3}lands?\b/gi,
  ],
  ["land (as a metaphor)", /\b(?:where|whether|if)\s+(?:it|that|the\s+\w+)\s+lands?\b/gi],
  ["land in the room", /\bland(?:ed|s)?\s+in\s+the\s+room\b/gi],
  // "The fix wasn't another patch, it was tracing it to the root."
  //
  // Two faults in one construction, which is why it is worth
  // matching: it defines the good thing by what it is not, the same
  // fault as "not a small thing"; and it joins two independent
  // clauses with a comma.
  //
  // Only this shape. General comma-splice detection needs to know
  // whether the first clause is independent, which a regex does
  // not: "When the team met, it was clear" is correct and looks
  // identical to a splice from here.
  [
    "not X, it was Y",
    /\b(?:wasn'?t|isn'?t|was\s+not|is\s+not)\s+[^,.;]{2,60},\s*(?:it|that|they|this)\s+(?:was|is|were|are)\b/gi,
  ],
  // "Stopped at who owns the calendar instead of another patch."
  //
  // The same fault as "not X, it was Y" in a different construction:
  // the good thing is defined by the thing that did not happen. One
  // debrief opener used it three times in four sentences.
  //
  // Same limit as that pattern: the other half is 2 to 60 characters
  // and stays inside its clause. It is broad on purpose. "Use the
  // new sheet instead of the old one" also matches, and on the
  // surfaces this runs on (a headline, an opener) the cost of that
  // is one retry that says the plain thing, never a wrong word shown
  // to anybody.
  ["X instead of Y", /\binstead\s+of\s+[^,.;:?!]{2,60}/gi],
  // Minimisers. "Just" earns its place by how often it arrives
  // attached to the thing being said, shrinking it on the way out.
  // Matched as the constructions that minimise rather than as the
  // bare word, which is ordinary in "just the three of them".
  [
    "just (minimiser)",
    /\b(?:I\s+)?just\s+(?:wanted|want|thought|a\s+quick|quickly|checking|to\s+say|to\s+check)\b/gi,
  ],
  ["just (minimiser)", /\b(?:it'?s|that'?s|this\s+is)\s+just\s+/gi],
  ["simply (minimiser)", /\bsimply\s+(?:put|a|the|wanted)\b/gi],
  // The intransitive metaphor, which is the shape that kept
  // slipping past: "two weeks of it not landing", "that never
  // landed". A message that does or does not land, with no object.
  ["land (as a metaphor)", /\b(?:not|never|barely|without|almost)\s+land(?:ing|ed|s)?\b/gi],
  ["land (as a metaphor)", /\b(?:it|that|this)\s+(?:finally\s+|really\s+)?land(?:ing|ed|s)\b/gi],
  [
    "float (as a metaphor)",
    /\b(?:instead\s+of|rather\s+than)\s+float(?:ing|s)?\b/gi,
  ],
];

// Transcript speaker labels. Their own check because the fix is not
// a rewrite of a phrase, it is the model admitting it does not know
// who spoke.
const SPEAKER_LABEL = /\bSpeaker\s+\d+/gi;

export function findBannedPhrases(text: string): BannedHit[] {
  const hits: BannedHit[] = [];
  const lower = text.toLowerCase();
  for (const phrase of PHRASES) {
    const at = lower.indexOf(phrase.toLowerCase());
    if (at === -1) continue;
    hits.push({
      phrase,
      context: text.slice(Math.max(0, at - 30), at + phrase.length + 30).replace(/\s+/g, " "),
    });
  }
  for (const [label, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      hits.push({
        phrase: label,
        context: text
          .slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)
          .replace(/\s+/g, " "),
      });
    }
  }
  for (const m of text.matchAll(SPEAKER_LABEL)) {
    hits.push({
      phrase: m[0],
      context: text
        .slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)
        .replace(/\s+/g, " "),
    });
  }
  return hits;
}

// One line for a log, naming what to fix rather than that something
// is wrong. A log that says "3 violations" sends somebody to read
// the whole output; this one does not.
export function describeHits(hits: readonly BannedHit[]): string {
  return hits.map((h) => `"${h.phrase}" in "…${h.context}…"`).join(" | ");
}

// The instruction added to a retry. Names the exact phrases rather
// than repeating the rules, because the rules were already there
// and were already ignored.
export function retryInstruction(hits: readonly BannedHit[]): string {
  const phrases = [...new Set(hits.map((h) => h.phrase))];
  return (
    `Your previous attempt used ${phrases
      .map((p) => `"${p}"`)
      .join(", ")}, which the rules forbid. Write it again without ` +
    `${phrases.length === 1 ? "that" : "those"}. Do not substitute a ` +
    `synonym for the same move: say the plain thing. Where it was a ` +
    `contrast, say what happened without what did not. If the ` +
    `problem is a speaker label, you do not know who spoke, so refer ` +
    `to the moment without naming anybody.`
  );
}
