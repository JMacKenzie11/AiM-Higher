// THE FACILITATION RUBRIC'S SHAPES.
//
// The rubric (AiMS-HQ Meeting Facilitation Rubric, Jason, 2026-11-27)
// scores ten parts of a team meeting 1 to 5 each. Here every level is
// a set of checks, and a part's score is worked out in code from which
// checks were met (engine.ts). The model never picks a number: it
// answers narrow questions about the conversation, and every other
// check comes from AiMS HQ's own records or is counted from the
// transcript. That is what makes the score repeatable.

export type PartKey =
  | "checkin"
  | "headlines"
  | "data"
  | "priorities"
  | "operational"
  | "dialogue"
  | "focus"
  | "container"
  | "structure"
  | "engagement";

// Where a check's answer comes from. Shown beside each check on the
// meeting page, so a reader can tell a record from a reading.
//   hq     the company's own records: commitments, measures, headlines
//   count  counted from the transcript, or from the model's per-item
//          answers about a list AiMS HQ supplied
//   judge  read from the conversation, with the moment it rests on
export type CheckSource = "hq" | "count" | "judge";

export type Level = 2 | 3 | 4 | 5;

// The meeting's own facts, from AiMS HQ (facts.ts).
export type RubricFacts = {
  // The goals this quarter's live priorities sit under: an annual goal,
  // or a focus area for a priority that hangs straight off one. The
  // rubric's "every goal named with its status" is checked at this
  // level, not per priority: teams hold 25 to 45 live priorities, more
  // than any weekly meeting names (Jason, 2026-11-27).
  goals: Array<{ id: string; title: string }>;
  // Commitments due since the last team meeting, made before this one.
  priorCommitments: Array<{
    id: string;
    description: string;
    owner: string | null;
    linkedToPriority: boolean;
  }>;
  // Made in this meeting.
  newCommitments: Array<{
    description: string;
    hasOwner: boolean;
    // It has a date. "By next meeting", the default when no day was
    // named, counts (DATE_RULE in rubric.ts).
    dateNamed: boolean;
    linkedToPriority: boolean;
  }>;
  // null when the company keeps no scorecard.
  measures: Array<{
    id: string;
    name: string;
    updated: boolean;
    offTrack: boolean;
  }> | null;
  // Functional areas with a headline box. sentAhead: filled before the
  // meeting by a person, not from the transcript.
  headlineAreas: Array<{ id: string; title: string; sentAhead: boolean }>;
  issuesRaised: number;
};

// Counted from the transcript (counts.ts).
export type TalkCounts = {
  speakers: Array<{ name: string; words: number; turns: number; share: number }>;
  // People who took a real part in the meeting, not a cough or a "yes".
  attendees: number;
  engaged: number;
  topShare: number;
};

export const AGENDA_SECTIONS = [
  "checkin",
  "headlines",
  "scorecard",
  "priorities",
  "issues",
  "commitments",
] as const;
export type SectionKey = (typeof AGENDA_SECTIONS)[number];

export type TopicOutcome = "decided" | "small_group" | "next_agenda" | "parked" | "open";

// One reading of the meeting by the model, after its moments have been
// checked against the transcript (verify.ts).
export type Observation = {
  judged: Record<string, { met: boolean; moment: string | null }>;
  checkinSharers: number;
  headlineAreasSpoken: string[];
  measures: Record<string, { discussed: boolean; flagged: boolean }>;
  goals: Record<string, { namedWithStatus: boolean }>;
  priorCommitments: Record<string, { reviewed: boolean }>;
  sections: Record<SectionKey, boolean>;
  topics: Array<{ title: string; outcome: TopicOutcome }>;
};

export type CheckInput = { obs: Observation; facts: RubricFacts; counts: TalkCounts };

// A check's answer. `na` is a check that does not apply to this
// meeting (no off-track measures to flag): it passes, and is shown
// neither as a win nor as a step.
export type CheckAnswer = { met: boolean; detail?: string | null; na?: boolean };

export type RubricCheck = {
  id: string;
  level: Level;
  source: CheckSource;
  // Shown when met. `{detail}` is replaced with the count, if any.
  well: string;
  // Shown when not met: the step that would take it higher. Always a
  // forward step, never a fault.
  better: string;
} & (
  | {
      kind: "judged";
      // Asked of the model, answered true or false.
      question: string;
      // False for a check that is met by something NOT happening
      // ("no long stories"): there is no moment to point to.
      needsMoment: boolean;
    }
  | { kind: "derived"; answer: (input: CheckInput) => CheckAnswer }
);

export type RubricPart = {
  key: PartKey;
  name: string;
  covers: string;
  checks: RubricCheck[];
};

export type CheckResult = {
  id: string;
  part: PartKey;
  level: Level;
  source: CheckSource;
  met: boolean;
  na: boolean;
  text: string;
  moment: string | null;
  // Runs that agreed with the answer, of all runs.
  agreed: number;
  runs: number;
};

export type PartScore = {
  key: PartKey;
  name: string;
  level: number; // 1 to 5
  wins: CheckResult[];
  better: CheckResult[];
};

export type RubricScore = {
  rubricVersion: number;
  parts: PartScore[];
  total: number; // 10 to 50
  // total / 5, as text with one decimal: "8.0"
  outOfTen: string;
  // Checks the runs split on. Shown nowhere yet; the eval reads it.
  split: string[];
};
