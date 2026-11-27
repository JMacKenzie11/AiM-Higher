import { countTurns, isUnknownSpeaker } from "./turns";
import type { TalkCounts } from "./types";
import { ATTENDEE_MIN_WORDS, ENGAGED_MIN_SHARE, ENGAGED_MIN_TURNS } from "./rubric";

// WHO TALKED, AND HOW MUCH. Counted from the transcript's turns
// (turns.ts), by words spoken: transcripts here keep who spoke but not
// when (extract.ts strips the cue times), so words stand in for time.
//
// `names` maps a transcript label to the person it is ("Speaker 3" to
// a name), from the pipeline's speaker map. Two labels for one person
// are counted as one person.
export function countTalk(transcript: string, names: Record<string, string> = {}): TalkCounts {
  const by = new Map<string, { words: number; turns: number }>();
  for (const turn of countTurns(transcript)) {
    if (!turn.speaker) continue;
    const who = names[turn.speaker] ?? turn.speaker;
    const words = turn.words.split(/\s+/).filter(Boolean).length;
    const row = by.get(who) ?? { words: 0, turns: 0 };
    row.words += words;
    row.turns += 1;
    by.set(who, row);
  }
  const total = [...by.values()].reduce((s, r) => s + r.words, 0);
  const speakers = [...by.entries()]
    .map(([name, r]) => ({ name, words: r.words, turns: r.turns, share: total ? r.words / total : 0 }))
    .sort((a, b) => b.words - a.words);
  // "UNKNOWN_SPEAKER" is every voice the tool could not tell apart:
  // its words count toward the whole, but it is not a person.
  const people = speakers.filter((s) => !isUnknownSpeaker(s.name));
  const present = people.filter((s) => s.words >= ATTENDEE_MIN_WORDS);
  const engaged = present.filter((s) => s.turns >= ENGAGED_MIN_TURNS && s.share >= ENGAGED_MIN_SHARE);
  return {
    speakers,
    attendees: present.length,
    engaged: engaged.length,
    topShare: people[0]?.share ?? 0,
  };
}
