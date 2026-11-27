// A TRANSCRIPT AS SPEAKER TURNS, for counting. Reads the three shapes
// transcripts arrive in:
//
//   Name: words                          (Teams, Drive, pasted)
//   Speaker 1  00:13 / words on the      (Otter: a header line with a
//   lines that follow                     time, then the words)
//   (00:28) Name: words                  (notes tools, after a summary
//                                         block and a "Transcript" line)
//
// When a "Transcript" line is present, everything before it is the
// tool's own summary and header, not the meeting, and is skipped.
export type CountTurn = { speaker: string | null; words: string };

const HEADER = /^(.{1,60}?)\s{2,}\(?\d{1,2}:\d{2}(?::\d{2})?\)?$/;
const STAMP = /^\(?\[?\d{1,2}:\d{2}(?::\d{2})?\]?\)?\s+/;
const NAMED = /^([^:]{1,60}):\s+(.*)$/;

export function countTurns(text: string): CountTurn[] {
  let lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*transcript\s*:?\s*$/i.test(l));
  if (start >= 0) lines = lines.slice(start + 1);
  const turns: CountTurn[] = [];
  let current: CountTurn | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const header = HEADER.exec(line);
    if (header) {
      current = { speaker: header[1].trim(), words: "" };
      turns.push(current);
      continue;
    }
    const unstamped = line.replace(STAMP, "");
    const named = NAMED.exec(unstamped);
    if (named) {
      current = { speaker: named[1].trim(), words: named[2] };
      turns.push(current);
    } else if (current) {
      current.words += (current.words ? " " : "") + unstamped;
    } else {
      current = { speaker: null, words: unstamped };
      turns.push(current);
    }
  }
  return turns.filter((t) => t.words.trim() !== "");
}

// A label that stands for nobody in particular.
export function isUnknownSpeaker(label: string): boolean {
  return /unknown|unidentified/i.test(label);
}
