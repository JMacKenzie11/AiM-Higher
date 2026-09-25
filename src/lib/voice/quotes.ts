// Did Aimee quote something nobody said?
//
// ---- WHY THIS IS ITS OWN CHECK ---------------------------------
//
// An opener contained: the question "what's actually underneath it"
// instead of "who screwed up the Tuesday." Nobody said "who screwed
// up the Tuesday." It was invented to make a contrast.
//
// That is a different class of fault from a banned word. A banned
// word is a tic; this puts words in a named room's mouth and hands
// them back as a record of their own meeting. It is the same shape
// as the 4Ws contradiction that cost trust before: the product
// stating something about a meeting that is not true of it.
//
// ---- WHAT COUNTS AS SUPPORTED ----------------------------------
//
// The quoted span has to appear in the source, and the source is
// the TRANSCRIPT: what was actually said. It was the summary, and a
// summary can put its own paraphrase in quotation marks, which made
// "in the summary" the wrong test. The checker reads the transcript
// server-side; the model generating the text still never sees it.
//
// Compared with whitespace collapsed, case folded, and the
// punctuation a model changes without meaning to (curly quotes,
// apostrophes, a trailing full stop) normalised away. A quote that is a real quote survives
// all of that; one that was invented does not start matching
// because of it.
//
// SHORT SPANS ARE IGNORED. One or two words inside quotation marks
// are usually a term being named ("the Tuesday", "owner") rather
// than speech being reported, and requiring those to appear
// verbatim would flag ordinary writing. Four words is where
// reported speech starts.

export type UnsupportedQuote = { quote: string };

const MIN_WORDS = 4;

function normalise(text: string): string {
  return text
    .toLowerCase()
    // Quote marks of every kind go, apostrophes with them, on both
    // sides alike. A summary quoted Speaker 1 as "As a 'this is what
    // it cost' thing" where the transcript has double quotes inside
    // the line, and a real quote was unquoted as a paraphrase.
    // Nesting changes the mark, never the words.
    .replace(/[‘’ʼ“”"']/g, "")
    .replace(/[–—]/g, " ")
    .replace(/[.,;:!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findUnsupportedQuotes(
  text: string,
  source: string
): UnsupportedQuote[] {
  const haystack = normalise(source);
  const out: UnsupportedQuote[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(QUOTED)) {
    const raw = m[1].trim();
    if (!isUnsupported(raw, haystack)) continue;
    const needle = normalise(raw);
    if (seen.has(needle)) continue;
    seen.add(needle);
    out.push({ quote: raw });
  }
  return out;
}

// Straight or curly, and either may close the other: a model that
// opens with a curly quote does not always close with one. This
// pattern was meant to include curly quotes from the start and did
// not, so a curly-quoted invention was never checked at all.
const QUOTED = /["\u201C]([^"\u201C\u201D\n]{1,300})["\u201D]/g;

function isUnsupported(raw: string, haystack: string): boolean {
  if (raw.length === 0) return false;
  if (raw.split(/\s+/).length < MIN_WORDS) return false;
  const needle = normalise(raw);
  return needle.length > 0 && !haystack.includes(needle);
}

// THE SUMMARISER'S QUOTATION MARKS, MADE TRUE.
//
// A summary put "who owns the calendar" and "who moved the crew" in
// quotation marks. Nobody said either. The debrief opener then
// quoted the first one back to the champion, and the quote check
// passed it, because it WAS in the summary: the invention had moved
// one step upstream, where nothing checked it.
//
// The prompt now says quotation marks mean the exact words. This is
// the part that does not depend on the model listening. Unlike a
// banned word, a wrong quotation mark CAN be fixed safely from
// outside: take the marks off and the same words stand as the
// summary's own paraphrase, which is what they were. Nothing is
// deleted and nothing is reworded.
//
// Same threshold as the check: spans under four words are terms
// being named, and are left alone.
export function unquoteUnsupported(
  text: string,
  source: string
): { text: string; unquoted: string[] } {
  const haystack = normalise(source);
  const unquoted: string[] = [];
  const out = text.replace(QUOTED, (whole, inner: string) => {
    if (!isUnsupported(inner.trim(), haystack)) return whole;
    unquoted.push(inner.trim());
    return inner;
  });
  return { text: out, unquoted };
}

// The instruction added to a retry, naming the invented quote. Told
// what to do instead rather than only what was wrong: the useful
// move is almost always to drop the contrast, not to find a real
// quote for the other half of it.
export function quoteRetryInstruction(
  quotes: readonly UnsupportedQuote[]
): string {
  const list = quotes.map((q) => `"${q.quote}"`).join(", ");
  return (
    `You quoted ${list}, which is not in the meeting transcript. ` +
    `Nobody said that. Write it again with quotation marks only around ` +
    `words the summary itself quotes, or with no quotation at all. If you ` +
    `need a contrast, describe it in your own words rather than inventing ` +
    `the other half of it.`
  );
}
