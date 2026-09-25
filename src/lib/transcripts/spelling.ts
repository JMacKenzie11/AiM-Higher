// SPELLINGS, CORRECTED AFTER GENERATION, BY LOOKUP.
//
// The prompts already ask for the company's spellings, and the model
// already has them in the company block. A Benson summary still wrote
// "Graham and Ann" for Grand Manan: the recording says it that way
// every time, and a model asked to transcribe faithfully does. So the
// correction is not asked for again. It is applied, to every
// generated string, on the way into storage, the same place em dashes
// are stripped.
//
// ---- TWO SOURCES, TWO RULES ------------------------------------
//
//   1. The company's list (company_spellings, migration 0237).
//      Places and suppliers. Each row names the misheard forms, and
//      those are replaced exactly: whole words, any case. Nothing is
//      guessed; if a form is not on the list it is left alone.
//
//   2. The company's people (the roster the extractor is given).
//      A word ONE letter from a roster FIRST name is corrected to it,
//      "Sherry" to "Sherri", everywhere it appears. Whether a word
//      qualifies is decided once, from the transcript, so a summary
//      never spells one person two ways. It qualifies when:
//        - the first name is at least 4 letters, and so is the word;
//        - exactly one roster first name is that close;
//        - it is not itself a roster name, a word of anybody's
//          position, or a listed spelling;
//        - in the transcript it appears capitalised, mid-sentence and
//          on its own at least once, and never in lower case and never
//          beside another capitalised word.
//      Each clause is a real miss. Measured on 32 dev summaries:
//        "Carry the thread further", a verb opening a generated
//          sentence, became "Carey": the transcript never said it;
//        "Glenn Mason", a new employee, became "Glenn Jason": a
//          surname, beside a capitalised word;
//        "Mine Grouting", a job title, became "Mike Grouting": a
//          position word.
//      "Wood" (Woody) and "case" (Casey) are ordinary words, and a
//      recording writes them in lower case.
//      A name that is right but close to a roster name (a floor
//      worker Kylie beside a user Kyle) goes on the list with no
//      misheard forms, and is then never touched.
//
// Every change is returned, and the pipeline logs them, so a wrong
// correction is visible in the logs rather than silent.

export type SpellingEntry = { spelling: string; heard_as: string[] };
export type SpellingChange = { from: string; to: string };
export type Speller = (text: string) => { text: string; changes: SpellingChange[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One insertion, deletion or substitution apart, and no more.
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function buildSpeller(input: {
  roster: ReadonlyArray<{ full_name: string; position?: string | null }>;
  entries: ReadonlyArray<SpellingEntry>;
  transcript: string;
}): Speller {
  // Longest misheard form first, so "Grand Menan Island" is replaced
  // before "Grand Menan" can take part of it.
  const phrases = input.entries
    .flatMap((e) =>
      e.heard_as
        .map((h) => h.trim())
        .filter((h) => h.length > 0 && h.toLowerCase() !== e.spelling.trim().toLowerCase())
        .map((h) => ({ from: h, to: e.spelling.trim() }))
    )
    .sort((a, b) => b.from.length - a.from.length);
  const phraseRes = phrases.map((p) => ({
    ...p,
    re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(p.from).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu"),
  }));

  const rosterNames = [
    ...new Set(
      input.roster.flatMap((p) => p.full_name.split(/\s+/)).filter((w) => /^\p{Lu}\p{Ll}+$/u.test(w))
    ),
  ];
  const known = new Set([
    ...rosterNames.map((w) => w.toLowerCase()),
    ...input.roster.flatMap((p) => (p.position ?? "").toLowerCase().match(/\p{L}+/gu) ?? []),
    ...input.entries.flatMap((e) => e.spelling.toLowerCase().split(/\s+/)),
  ]);
  const targets = [
    ...new Set(
      input.roster
        .map((p) => p.full_name.trim().split(/\s+/)[0] ?? "")
        .filter((w) => /^\p{Lu}\p{Ll}{3,}$/u.test(w))
    ),
  ];

  // Read the transcript once, word by word.
  const alone = new Set<string>();
  const disqualified = new Set<string>();
  const words = [...input.transcript.matchAll(/[\p{L}'’-]+|[.!?\n]/gu)].map((m) => m[0]);
  const startsSentence = (i: number) => i === 0 || /^[.!?\n]$/.test(words[i - 1]);
  // A capitalised neighbour makes a longer name ("Glenn Mason") only
  // when it is itself mid-sentence. "And Sherry sat in" and "Hi
  // Brendan" are capitalised because they open a sentence.
  const nameWord = (i: number) =>
    i >= 0 && i < words.length && /^\p{Lu}/u.test(words[i]) && !startsSentence(i);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\p{Ll}+$/u.test(w)) {
      disqualified.add(w);
      continue;
    }
    if (!/^\p{Lu}\p{Ll}+$/u.test(w)) continue;
    const key = w.toLowerCase();
    if (nameWord(i - 1) || nameWord(i + 1)) disqualified.add(key);
    else if (!startsSentence(i)) alone.add(key);
  }

  const corrections = new Map<string, string>();
  for (const key of alone) {
    if (key.length < 4 || known.has(key) || disqualified.has(key)) continue;
    const hits = targets.filter((t) => withinOneEdit(t.toLowerCase(), key));
    if (hits.length === 1) corrections.set(key, hits[0]);
  }

  return (text: string) => {
    const changes: SpellingChange[] = [];
    let out = text;
    for (const p of phraseRes) {
      out = out.replace(p.re, (m) => {
        changes.push({ from: m, to: p.to });
        return p.to;
      });
    }
    out = out.replace(/(?<![\p{L}\p{N}'’])\p{Lu}\p{Ll}+(?![\p{L}\p{N}])/gu, (word) => {
      const to = corrections.get(word.toLowerCase());
      if (!to) return word;
      changes.push({ from: word, to });
      return to;
    });
    return { text: out, changes };
  };
}

// For the log line: "Graham and Ann -> Grand Manan (x3), Sherry -> Sherri".
export function describeChanges(changes: readonly SpellingChange[]): string {
  const counts = new Map<string, number>();
  for (const c of changes) {
    const k = `${c.from} -> ${c.to}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => (n > 1 ? `${k} (x${n})` : k)).join(", ");
}

// What is stored (meeting_analyses.spelling_changes, 0238) and what
// the weekly report reads: each distinct change once, with its count.
export function summariseChanges(
  changes: readonly SpellingChange[]
): Array<{ from: string; to: string; count: number }> {
  const out = new Map<string, { from: string; to: string; count: number }>();
  for (const c of changes) {
    const k = `${c.from}\u0000${c.to}`;
    const hit = out.get(k);
    if (hit) hit.count += 1;
    else out.set(k, { from: c.from, to: c.to, count: 1 });
  }
  return [...out.values()];
}
