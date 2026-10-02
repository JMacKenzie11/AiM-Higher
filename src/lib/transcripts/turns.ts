// A transcript as turns, for the transcript page
// (app/(app)/leadership/meetings/[id]/transcript).
//
// "Name: words" starts a turn, with the name set apart so a long
// transcript can be followed by who is speaking. Recordings often break
// one person's turn across several lines; a line that does not start a
// turn continues the one before it, so a turn reads as one paragraph.
export type Turn = { speaker: string | null; words: string };

export function turnsOf(text: string): Turn[] {
  const turns: Turn[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:]{1,60}):\s+(.*)$/.exec(line);
    if (m) turns.push({ speaker: m[1], words: m[2] });
    else if (turns.length > 0) turns[turns.length - 1].words += ` ${line}`;
    else turns.push({ speaker: null, words: line });
  }
  return turns;
}

