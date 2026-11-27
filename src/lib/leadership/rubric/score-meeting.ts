import type Anthropic from "@anthropic-ai/sdk";
import type { Thinking } from "@/lib/transcripts/model";
import { answerChecks, mergeReadings, scoreRubric } from "./engine";
import { countTalk } from "./counts";
import { observeMeeting, type Reading } from "./observe";
import type { CheckResult, RubricFacts, RubricScore, TalkCounts } from "./types";

// A MEETING, SCORED AGAINST THE RUBRIC.
//
// READINGS. The judged checks are read RUBRIC_READINGS times and each
// check takes the majority answer (engine.ts, mergeReadings). One
// reading can tip a borderline check either way; three readings agree
// with each other far more often than any one does with itself. The
// first reading runs alone and caches the transcript; the rest read
// it from the cache, in parallel.
export const RUBRIC_READINGS = 3;

export type RubricRun = {
  score: RubricScore;
  results: CheckResult[];
  counts: TalkCounts;
  readings: number;
  momentsRejected: string[];
  usage: Anthropic.Usage[];
};

// The readings alone. Needs only what the model is shown: the goals,
// last week's commitments, the measures and the areas. The pipeline
// starts this beside the summary and the extraction, and scores the
// readings once the extraction has said what this meeting committed
// to (scoreReadings).
export async function readMeeting(
  client: Anthropic,
  args: {
    model: string;
    transcript: string;
    contextBlock: string;
    facts: RubricFacts;
    readings?: number;
    thinking?: Thinking;
    onReading?: (r: Reading) => void;
  }
): Promise<Reading[] | null> {
  const wanted = Math.max(1, args.readings ?? RUBRIC_READINGS);
  const read = () =>
    observeMeeting(client, {
      model: args.model,
      transcript: args.transcript,
      contextBlock: args.contextBlock,
      facts: args.facts,
      thinking: args.thinking,
      cache: wanted > 1,
    }).then((r) => {
      if (r) args.onReading?.(r);
      return r;
    });
  const first = await read();
  const rest = await Promise.all(Array.from({ length: wanted - 1 }, () => read()));
  const readings = [first, ...rest].filter((r): r is Reading => r !== null);
  // A majority of the readings asked for, or no score: two failed
  // readings out of three leave one reading deciding alone.
  return readings.length * 2 > wanted ? readings : null;
}

export function scoreReadings(
  readings: Reading[],
  args: { transcript: string; facts: RubricFacts; names?: Record<string, string> }
): RubricRun {
  const counts = countTalk(args.transcript, args.names ?? {});
  const results = mergeReadings(readings.map((r) => answerChecks({ obs: r.obs, facts: args.facts, counts })));
  return {
    score: scoreRubric(results),
    results,
    counts,
    readings: readings.length,
    momentsRejected: readings.flatMap((r) => r.momentsRejected),
    usage: readings.map((r) => r.usage).filter((u): u is Anthropic.Usage => u !== null),
  };
}

export async function scoreMeeting(
  client: Anthropic,
  args: {
    model: string;
    transcript: string;
    contextBlock: string;
    facts: RubricFacts;
    // Transcript label to person, from the speaker map.
    names?: Record<string, string>;
    readings?: number;
    thinking?: Thinking;
    onReading?: (r: Reading) => void;
  }
): Promise<RubricRun | null> {
  const readings = await readMeeting(client, args);
  return readings ? scoreReadings(readings, args) : null;
}
