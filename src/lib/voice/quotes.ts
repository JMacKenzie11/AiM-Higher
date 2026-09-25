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
// The quoted span has to appear in the source. Compared with
// whitespace collapsed, case folded, and the punctuation a model
// changes without meaning to (curly quotes, apostrophes, a trailing
// full stop) normalised away. A quote that is a real quote survives
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
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
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

  for (const m of text.matchAll(/[""]([^""]{1,300})[""]|"([^"]{1,300})"/g)) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (raw.length === 0) continue;
    if (raw.split(/\s+/).length < MIN_WORDS) continue;
    const needle = normalise(raw);
    if (needle.length === 0 || haystack.includes(needle)) continue;
    if (seen.has(needle)) continue;
    seen.add(needle);
    out.push({ quote: raw });
  }
  return out;
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
    `You quoted ${list}, which does not appear in the meeting summary. ` +
    `Nobody said that. Write the turn again quoting only words that are ` +
    `in the summary, and if you need a contrast, describe it in your own ` +
    `words rather than inventing the other half of it.`
  );
}
