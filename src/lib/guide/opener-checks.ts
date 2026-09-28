import {
  findBannedPhrases,
  describeHits,
  retryInstruction,
  type BannedHit,
} from "@/lib/voice/banned";
import {
  findJoinedQuestions,
  joinedQuestionRetryInstruction,
} from "@/lib/voice/questions";

// Every check a GENERATED opener has to pass, in one place, so the
// route asks one question and a test can ask the same one.
//
// A generated opener is the one turn nobody typed, and it is buffered
// rather than streamed (see route.ts), which is what makes checking it
// before anybody reads it possible at all. Today that is an agent with
// firstTurn "generate", or one auto-opened to revise a document.
//
// The Meeting Debrief no longer generates one (2026-09-28). Opened
// from a Guide invitation, its first turn is the invitation's own
// line; from the agent list, a scripted line (practices/create.ts).
// The checks that existed only for its generated opener went with it:
// repeating the invitation, leaving its subject, the 20-word sentence
// limit, and quotes checked against the meeting transcript.

export type OpenerFaults = {
  banned: BannedHit[];
  joined: string[];
};

export function checkOpener(text: string): OpenerFaults {
  return {
    banned: findBannedPhrases(text),
    joined: findJoinedQuestions(text),
  };
}

// A count, so a retry that fixes two faults and keeps one can be
// preferred to the attempt that had all three. Each fault counts
// once: two banned phrases are two things to fix.
export function faultCount(f: OpenerFaults): number {
  return f.banned.length + f.joined.length;
}

// For the log: what is wrong, where, in one line.
export function describeFaults(f: OpenerFaults): string {
  return [
    f.joined.length > 0 ? `two questions joined by "and"` : null,
    f.banned.length > 0 ? describeHits(f.banned) : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export function openerRetryInstruction(f: OpenerFaults): string {
  return [
    f.joined.length > 0 ? joinedQuestionRetryInstruction(f.joined) : null,
    f.banned.length > 0 ? retryInstruction(f.banned) : null,
  ]
    .filter(Boolean)
    .join(" ");
}
