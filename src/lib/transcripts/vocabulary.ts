import "server-only";

// WHAT THIS COMPANY'S WORDS ARE, from what the company already has.
//
// ---- WHY NOT A GLOSSARY ----------------------------------------
//
// A per-company term list somebody maintains only helps with words
// somebody thought to add, and goes stale the week nobody does. The
// people list, the functional chart and the One-Page Plan are
// already maintained, already correct, and already contain most of
// the proper nouns a meeting uses.
//
// ---- WHAT IT COVERS, MEASURED ----------------------------------
//
// Checked against a real Benson Seafood meeting: the derived
// vocabulary held Grand Manan, tankhouse, RTE and EI from the plan
// and chart, plus all 13 roster names and 8 function titles. It did
// NOT hold Vern, Andre, Chrissy, Danny, Nancy, Trish, Brie, Trapp,
// LMIA, ROE or Master Packaging — floor staff who are not users,
// and outside terms nothing in the company's data mentions.
//
// So this does two different jobs, and only one of them is
// correction:
//
//   a name close to one we hold is CORRECTED to ours ("Sherry" ->
//   "Sherri"), because there is something real to correct toward;
//
//   a name we do not hold is carried as the transcript said it and
//   reported as unverified. Never corrected toward something that
//   merely looks similar.
//
// What it cannot do, stated plainly: if the recording consistently
// mishears a name the company's data has never seen, nothing here
// catches it. The flag says "unverified", not "wrong".

export type Vocabulary = {
  // Everything the company can vouch for, lowercased for matching.
  known: Set<string>;
  // The display spellings, for correcting a near miss.
  canonical: Map<string, string>;
};

const WORD = /[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)*/g;

function add(vocab: Vocabulary, phrase: string | null | undefined): void {
  if (!phrase) return;
  const trimmed = phrase.trim();
  if (trimmed.length < 2) return;
  vocab.known.add(trimmed.toLowerCase());
  vocab.canonical.set(trimmed.toLowerCase(), trimmed);
  // Individual words too: a roster of "Darlene Clinch" should
  // verify a transcript that only ever says "Darlene".
  for (const part of trimmed.split(/\s+/)) {
    if (part.length >= 3) {
      vocab.known.add(part.toLowerCase());
      if (!vocab.canonical.has(part.toLowerCase())) {
        vocab.canonical.set(part.toLowerCase(), part);
      }
    }
  }
}

export function buildVocabulary(input: {
  roster: Array<{ full_name: string; position?: string | null }>;
  functionTitles: string[];
  // Free text from the One-Page Plan. Proper nouns are lifted out of
  // it — "Grand Manan" and "RTE" live in a purpose statement, not in
  // a field named after them.
  planText: string[];
}): Vocabulary {
  const vocab: Vocabulary = { known: new Set(), canonical: new Map() };
  for (const p of input.roster) {
    add(vocab, p.full_name);
    add(vocab, p.position ?? null);
  }
  for (const t of input.functionTitles) add(vocab, t);
  for (const text of input.planText) {
    for (const m of text.match(WORD) ?? []) add(vocab, m);
    // Acronyms, which the capitalised-phrase pattern skips.
    for (const m of text.match(/\b[A-Z]{2,6}\b/g) ?? []) add(vocab, m);
  }
  return vocab;
}

// Words that start a sentence, or are simply common, and would
// otherwise read as proper nouns. Deliberately short: the cost of
// missing one is a name on the unverified list that did not need to
// be there, which is far cheaper than silently vouching for a name
// nobody checked.
const COMMON = new Set(
  ("i we you he she they it that this there here what when where why how " +
    "and but so or if then than the a an is are was were be been being do " +
    "does did have has had can could will would should may might must " +
    "yeah yes no okay ok right well just like really actually because " +
    "monday tuesday wednesday thursday friday saturday sunday january " +
    "february march april may june july august september october november " +
    "december speaker thanks thank hi hello good morning afternoon evening " +
    "everyone everybody something anything nothing someone anybody " +
    "one two three four five six seven eight nine ten let lets going get " +
    "got know think see say said talk talking need want make made take " +
    "first second next last week month year day today tomorrow yesterday " +
    "likely please confirm unassigned none stated meeting team company")
    .split(" ")
);

// A token that could be a name: capitalised, or a short acronym.
// Contractions are excluded outright — "I'll" and "There's" read as
// capitalised words to any regex and are never names.
function candidates(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(/\b[A-Za-z][A-Za-z'’-]*\b/g) ?? []) {
    if (/['’]/.test(raw)) continue;
    const isCapitalised = /^[A-Z][a-z-]+$/.test(raw);
    const isAcronym = /^[A-Z]{2,6}$/.test(raw);
    if (!isCapitalised && !isAcronym) continue;
    out.push(raw);
  }
  return out;
}

// Names in the SUMMARY that the company's own data cannot vouch for.
//
// ---- WHY THE SUMMARY AND NOT THE TRANSCRIPT --------------------
//
// Scanning the transcript reports every name anybody said, most of
// which never reach the reader — noise that trains people to ignore
// the warning. What matters is a name that made it into a
// commitment, an attendee list or a paragraph somebody will act on.
//
// Measured on a real transcript while building this: "Grand Manan"
// appears ZERO times and "Graham" five, because the recording
// consistently mishears it. The company's plan holds "Grand Manan",
// so the correct spelling is known and the misheard one is reported
// — which is the case this is for.
//
// Single occurrence is enough here. A name only has to appear once
// in a summary to be acted on, and the list is short because the
// summary is short.
export function unverifiedNames(
  summaryText: string,
  vocab: Vocabulary
): string[] {
  const seen = new Map<string, string>();
  for (const token of candidates(summaryText)) {
    const key = token.toLowerCase();
    if (vocab.known.has(key)) continue;
    if (COMMON.has(key)) continue;
    if (!seen.has(key)) seen.set(key, token);
  }
  // Join adjacent unverified tokens: "Master Packaging" reads as one
  // name, not two.
  const joined: string[] = [];
  const names = [...seen.values()];
  const pattern = new RegExp(
    `\\b(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(\\s+(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))*\\b`,
    "g"
  );
  if (names.length > 0) {
    for (const m of summaryText.match(pattern) ?? []) {
      if (!joined.includes(m)) joined.push(m);
    }
  }
  // Drop a single token that only ever appears inside a longer name.
  return joined
    .filter((n) => !joined.some((o) => o !== n && o.includes(n)))
    .slice(0, 20);
}

// A near miss the company CAN correct: the summary says "Sherry",
// the roster says "Sherri". Only offered when there is something
// real to correct toward — never toward a word that merely looks
// similar to another unverified one.
export function nearMiss(name: string, vocab: Vocabulary): string | null {
  const key = name.toLowerCase();
  if (vocab.known.has(key)) return null;
  for (const known of vocab.known) {
    if (Math.abs(known.length - key.length) > 2) continue;
    if (known.length < 4) continue;
    let diff = 0;
    const a = known, b = key;
    for (let i = 0, j = 0; i < a.length || j < b.length; ) {
      if (a[i] === b[j]) { i++; j++; continue; }
      diff++;
      if (diff > 1) break;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    if (diff <= 1) return vocab.canonical.get(known) ?? null;
  }
  return null;
}
