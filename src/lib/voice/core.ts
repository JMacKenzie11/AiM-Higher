// The rules every generated word obeys, whatever the surface.
//
// ---- WHY THIS EXISTS -------------------------------------------
//
// There were two rule blocks, coach and strengths, whose own headers
// said "keep both in sync" — and nothing did. A third surface (the
// Guide's nudge headline) grew its own short list. A fourth, the
// MEETING SUMMARISER, had no voice rules at all: every summary a
// client reads was generated with a four-line style guide and
// nothing else.
//
// So the shared half lives here once and each surface composes it
// with its own.
//
// ---- WHAT BELONGS HERE, AND WHAT DOES NOT ----------------------
//
// Only rules that are true of a BOARD MEMO and a CHAT TURN alike.
// The summariser writes a document; the coach writes conversation.
// Their differences are real and some of them are direct
// contradictions:
//
//   coach       "contractions throughout"
//   summariser  "not casual"
//
//   coach       "avoid bulleted lists inside coaching turns"
//   summariser  structured headings and bullets, by design
//
// Pasting one surface's rules into another would damage it. So
// anything about person, rhythm, contractions, list usage, turn
// structure or question count stays with its own surface. What is
// left is vocabulary, punctuation and a handful of habits that are
// wrong everywhere.

export const VOICE_CORE = `Universal copy rules (mandatory on every surface):

- Never use em-dashes anywhere. Use commas, periods, or parentheses instead. En-dashes are only for numeric ranges, never as sentence connectors.
- Say what a thing IS, never what it is not. Never affirm something by denying its opposite: not "that's not a small thing," not "no small feat," not "that's not nothing," not "that's not an accident," not "no accident," not "not insignificant," not "not trivial," not "not uncommon," not "not by chance." Denying the opposite makes a compliment sound grudging, because the reader has to work out what you meant from what you ruled out. Say the positive thing plainly instead: "that's significant," "that's a sign of a healthy team," "that took real discipline," "most teams can't do that." The same fault shows up in criticism, where "this isn't clear" is weaker than "I can't tell what you're asking for."
- Every sentence is a complete sentence, including questions. No fragments. Not "Five minutes?", not "Worth a look?", not "Sound good?", not "Thoughts?". Write the whole question: "Do you have five minutes to think about it?" A fragment reads as a text message, and it is the shape that makes generated copy sound generated.
- Say the literal thing rather than a metaphor for it. If a sentence reaches for an image to describe something abstract, replace the image with the concrete thing it stands for.
- Every sentence is grammatically correct, and every item in a list shares the same grammatical form.

Banned words and phrases (do not appear anywhere in output):
- delve, delve into, dive in, dive into, dive deep
- unpack, unpacking, tease apart, tease out
- leverage (as a verb), harness, unlock (as a metaphor), robust, seamless, seamlessly, game-changer, game-changing
- circle back, level-set, level set, touch base, sync up
- quietly (as an intensifier)
- moves the needle, opens a door, closes a door, builds a bridge, plants a flag
- "it's worth noting," "at the end of the day," "in conclusion," "to summarize"
- "the good news is," "the bad news is"
- "in today's fast-paced business environment"
- synergy, synergize
- "not a small thing," "no small thing," "no small feat," "not nothing," "not an accident," "no accident," "not insignificant," "not trivial," "not uncommon," "not by chance"`;
