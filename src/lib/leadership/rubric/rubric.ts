import type {
  CheckAnswer,
  CheckInput,
  Level,
  RubricCheck,
  RubricPart,
  SectionKey,
} from "./types";
import { AGENDA_SECTIONS } from "./types";

// THE RUBRIC AS CHECKS.
//
// Each part of Jason's rubric (AiMS-HQ Meeting Facilitation Rubric,
// draft, 2026-11-27) is written here as checks, one level at a time.
// A part reaches a level when every check at that level AND below it
// is met (engine.ts). Level 1 has no checks: it is where every part
// starts.
//
// A check with `false` as its last argument has no single moment to
// point to: it is about the whole meeting ("stayed mostly on track"),
// or about something not happening. The first eval rejected the
// moments offered for these far more than any other (2026-11-27),
// because no one line shows them.
//
// Change a check, its level or its wording here and nowhere else. A
// change that moves scores bumps RUBRIC_VERSION, so a stored score can
// always say which rubric gave it.
//
// COPY RULES for `well` and `better` (both are shown to the team):
// plain English, no dashes standing in for punctuation, no gendered
// pronouns, and no person named as the cause of a gap. `better` is
// always a step forward, never a description of what went wrong.
export const RUBRIC_VERSION = 1;

// Does "By next meeting", the default when nobody named a day, count
// as a date for "every new commitment has a date"? Yes (Jason,
// 2026-11-27): a commitment due by the next meeting has a date.
export const DATE_RULE = { nextMeetingCountsAsDate: true } as const;

// Engagement. A person took a real part when they spoke at least this
// often and this much. Tuned by the eval (scripts/rubric-eval.mts).
export const ENGAGED_MIN_TURNS = 4;
export const ENGAGED_MIN_SHARE = 0.04;
// Below this many words in the whole meeting, a speaker label is a
// cough, a crosstalk fragment or a "thanks, bye", not an attendee.
export const ATTENDEE_MIN_WORDS = 25;
// "No one person does more than 65% of the talking" (the rubric's
// level 1 names the facilitator; Jason, 2026-11-27: score how it was
// facilitated, not who did it).
export const TOP_SHARE_LIMIT = 0.65;

function ofTotal(n: number, m: number): string {
  return `${n} of ${m}`;
}

// Every item in a list met the test. An empty list does not apply.
function every<T>(items: T[], test: (t: T) => boolean): CheckAnswer {
  if (items.length === 0) return { met: true, na: true };
  const n = items.filter(test).length;
  return { met: n === items.length, detail: ofTotal(n, items.length) };
}

// At least this share of a list met the test.
function atLeast<T>(items: T[], share: number, test: (t: T) => boolean): CheckAnswer {
  if (items.length === 0) return { met: true, na: true };
  const n = items.filter(test).length;
  return { met: n / items.length >= share, detail: ofTotal(n, items.length) };
}

function judged(
  id: string,
  level: Level,
  question: string,
  well: string,
  better: string,
  needsMoment = true
): RubricCheck {
  return { id, level, source: "judge", kind: "judged", question, needsMoment, well, better };
}

function derived(
  id: string,
  level: Level,
  source: "hq" | "count",
  answer: (input: CheckInput) => CheckAnswer,
  well: string,
  better: string
): RubricCheck {
  return { id, level, source, kind: "derived", answer, well, better };
}

// A judged answer, read inside a derived check.
function said(input: CheckInput, id: string): boolean {
  return input.obs.judged[id]?.met === true;
}

const SECTION_NAMES: Record<SectionKey, string> = {
  checkin: "Positive check-in",
  headlines: "Headlines",
  scorecard: "Scorecard",
  priorities: "Goals and priorities",
  issues: "Issues",
  commitments: "Commitments",
};

function sectionsCovered(input: CheckInput): number {
  return AGENDA_SECTIONS.filter((s) => input.obs.sections[s]).length;
}

export const RUBRIC: RubricPart[] = [
  {
    key: "checkin",
    name: "Positive check-in",
    covers: "Positive check-in, acknowledging good actions and wins.",
    checks: [
      judged(
        "checkin_held",
        2,
        "Did the meeting open with a check-in, where people said something about themselves or their week, before getting into business?",
        "The meeting opened with a check-in",
        "Open with a check-in before getting into business."
      ),
      judged(
        "checkin_real",
        3,
        "Was the check-in a real one, where people shared something that mattered to them and the others listened, rather than quick small talk?",
        "The check-in was a real one, with people sharing what mattered to them",
        "Give the check-in its full time, so each person can share something that matters."
      ),
      derived(
        "checkin_everyone",
        4,
        "count",
        ({ obs, counts }) =>
          counts.attendees === 0
            ? { met: true, na: true }
            : {
                met: obs.checkinSharers >= counts.attendees,
                detail: ofTotal(Math.min(obs.checkinSharers, counts.attendees), counts.attendees),
              },
        "Everyone shared a check-in ({detail})",
        "Make sure everyone gets a turn in the check-in ({detail} this week)."
      ),
      judged(
        "wins_acknowledged",
        4,
        "Were wins or good actions acknowledged, by anyone, during the check-in or the meeting?",
        "Wins and good actions were celebrated",
        "Celebrate a win or a good action from the week."
      ),
      judged(
        "acknowledged_specific",
        5,
        "Did at least one acknowledgment name the person and the specific thing they did, rather than a general \"great job, team\"?",
        "Thanks named the person and what they did",
        "Thank people by name for the specific thing they did."
      ),
    ],
  },
  {
    key: "headlines",
    name: "Headlines",
    covers: "Brief headlines and updates.",
    checks: [
      judged(
        "headlines_held",
        2,
        "Did people give headlines or updates on their area of the business?",
        "Headlines were shared",
        "Give each area a short headline slot."
      ),
      judged(
        "headlines_no_long_stories",
        3,
        "Did updates stay as updates? Answer true unless an update ran on as a long story and nobody brought it back.",
        "Updates stayed on track",
        "When an update becomes a long story, bring it back to the short version.",
        false
      ),
      // Asked every time; used only when the company has no functional
      // areas to check headlines against.
      judged(
        "headlines_everyone",
        4,
        "Did every person present give an update?",
        "Everyone gave an update",
        "Hear a headline from every area."
      ),
      derived(
        "headlines_every_area",
        4,
        "hq",
        (input) => {
          const areas = input.facts.headlineAreas;
          if (areas.length === 0) return { met: said(input, "headlines_everyone") };
          const spoken = new Set(input.obs.headlineAreasSpoken);
          return every(areas, (a) => a.sentAhead || spoken.has(a.id));
        },
        "A headline from every area, in the meeting or sent ahead ({detail})",
        "Hear from every area, and ask anyone away to send theirs ahead ({detail} this week)."
      ),
      judged(
        "headlines_tight",
        5,
        "Were headlines kept brief, with anything that needed discussion moved to Issues rather than discussed on the spot?",
        "Headlines stayed tight, with discussion saved for Issues",
        "When a headline opens a bigger conversation, add it to Issues so it gets its full time there."
      ),
    ],
  },
  {
    key: "data",
    name: "Critical Success Factors and data",
    covers: "Scorecard and critical success factors.",
    checks: [
      judged(
        "data_reviewed",
        2,
        "Were numbers reviewed at all: the scorecard, measures or other data?",
        "The numbers were reviewed",
        "Make time to look at the numbers."
      ),
      derived(
        "numbers_updated",
        3,
        "hq",
        ({ facts }) => (facts.measures === null ? { met: true, na: true } : every(facts.measures, (m) => m.updated)),
        "Every number was updated before the meeting ({detail})",
        "Ask everyone to update their numbers before the meeting ({detail} this week)."
      ),
      judged(
        "numbers_owned",
        3,
        "Did people speak to their numbers as they were? Answer true unless someone made excuses for a number or deflected from it.",
        "People owned their numbers as they were",
        "Talk about each number as it is, and what it tells the team.",
        false
      ),
      // Used only when the company keeps no scorecard in AiMS HQ.
      judged(
        "scorecard_full_said",
        4,
        "Was the whole scorecard or set of measures reviewed, not just some of it?",
        "The whole scorecard was reviewed",
        "Walk the whole scorecard."
      ),
      derived(
        "scorecard_full",
        4,
        "count",
        (input) =>
          input.facts.measures === null
            ? { met: said(input, "scorecard_full_said") }
            : every(input.facts.measures, (m) => input.obs.measures[m.id]?.discussed === true),
        "The whole scorecard was reviewed ({detail})",
        "Walk every measure on the scorecard ({detail} came up this week)."
      ),
      judged(
        "data_meaning",
        4,
        "Did the team draw meaning from the numbers, what they show and why, rather than only reading them out?",
        "The team drew meaning from the numbers",
        "For each number, ask what it is telling the team."
      ),
      judged(
        "off_track_flagged_said",
        5,
        "Was every measure that was off track flagged so the team understood it, or moved to Issues? Answer true if nothing was off track.",
        "Off-track measures were flagged",
        "Flag each off-track measure, or move it to Issues.",
        false
      ),
      derived(
        "off_track_flagged",
        5,
        "hq",
        (input) => {
          if (input.facts.measures === null) return { met: said(input, "off_track_flagged_said") };
          const off = input.facts.measures.filter((m) => m.offTrack);
          return every(off, (m) => input.obs.measures[m.id]?.flagged === true);
        },
        "Every off-track measure was flagged or moved to Issues ({detail})",
        "Flag each off-track measure, or move it to Issues ({detail} this week)."
      ),
    ],
  },
  {
    key: "priorities",
    name: "Goals and priorities",
    covers: "Goals, priorities and actions; last week's commitments; new commitments with an owner and a date.",
    checks: [
      judged(
        "priorities_mentioned",
        2,
        "Did the company's goals, priorities or commitments come up at all?",
        "Goals and priorities came up",
        "Bring the priorities into the meeting."
      ),
      judged(
        "priorities_worked",
        3,
        "Did the team spend time working on its priorities, beyond a passing mention?",
        "The team worked on its priorities",
        "Give the priorities real time in the meeting."
      ),
      derived(
        "goals_named",
        4,
        "count",
        ({ facts, obs }) => every(facts.goals, (g) => obs.goals[g.id]?.namedWithStatus === true),
        "Every goal was named with its status ({detail})",
        "Name each goal and say where it stands ({detail} this week)."
      ),
      derived(
        "priority_commitments_reviewed",
        4,
        "count",
        ({ facts, obs }) =>
          every(
            facts.priorCommitments.filter((c) => c.linkedToPriority),
            (c) => obs.priorCommitments[c.id]?.reviewed === true
          ),
        "Last week's priority commitments were each reviewed ({detail})",
        "Review each of last week's priority commitments as done or not done ({detail} this week)."
      ),
      derived(
        "priority_new_complete",
        5,
        "hq",
        ({ facts }) =>
          every(
            facts.newCommitments.filter((c) => c.linkedToPriority),
            (c) => c.hasOwner && c.dateNamed
          ),
        "Every new priority commitment has an owner and a date ({detail})",
        "Give every new commitment an owner and a day before moving on ({detail} this week)."
      ),
    ],
  },
  {
    key: "operational",
    name: "Operational commitments",
    covers: "Commitments not tied to a priority, including operational and Just Do items.",
    checks: [
      derived(
        "operational_any",
        2,
        "count",
        (input) => ({
          met:
            said(input, "operational_mentioned") ||
            input.facts.newCommitments.some((c) => !c.linkedToPriority) ||
            input.facts.priorCommitments.some(
              (c) => !c.linkedToPriority && input.obs.priorCommitments[c.id]?.reviewed === true
            ),
        }),
        "Operational commitments were part of the meeting",
        "Review operational commitments, and agree new ones."
      ),
      judged(
        "operational_mentioned",
        2,
        "Did commitments that are not about a priority, such as operational or Just Do items, come up?",
        "Operational commitments came up",
        "Make time for operational commitments."
      ),
      derived(
        "operational_some_reviewed",
        3,
        "count",
        ({ facts, obs }) =>
          atLeast(
            facts.priorCommitments.filter((c) => !c.linkedToPriority),
            0.5,
            (c) => obs.priorCommitments[c.id]?.reviewed === true
          ),
        "Most of last week's operational commitments were reviewed ({detail})",
        "Review last week's operational commitments ({detail} this week)."
      ),
      derived(
        "operational_all_reviewed",
        4,
        "count",
        ({ facts, obs }) =>
          every(
            facts.priorCommitments.filter((c) => !c.linkedToPriority),
            (c) => obs.priorCommitments[c.id]?.reviewed === true
          ),
        "Last week's operational commitments were each reviewed ({detail})",
        "Review each operational commitment as done or not done ({detail} this week)."
      ),
      derived(
        "operational_new_complete",
        5,
        "hq",
        ({ facts }) =>
          every(
            facts.newCommitments.filter((c) => !c.linkedToPriority),
            (c) => c.hasOwner && c.dateNamed
          ),
        "Every new operational commitment has an owner and a date ({detail})",
        "Give every new operational commitment an owner and a day ({detail} this week)."
      ),
    ],
  },
  {
    key: "dialogue",
    name: "Generative dialogue",
    covers: "Quality of questions; issues to solutions and commitments.",
    checks: [
      derived(
        "issues_identified",
        2,
        "count",
        (input) =>
          input.facts.issuesRaised > 0
            ? { met: true, detail: String(input.facts.issuesRaised) }
            : { met: said(input, "issues_identified_said") },
        "Issues were brought into the open",
        "Ask the team what is getting in the way, and list it as an issue."
      ),
      judged(
        "issues_identified_said",
        2,
        "Were any issues or opportunities identified for the team to work on?",
        "Issues were brought into the open",
        "Ask the team what is getting in the way."
      ),
      judged(
        "some_open_questions",
        3,
        "Were at least some questions open (what, how, tell me more) rather than nearly all yes/no or logistics?",
        "Open questions got people talking",
        "Swap a yes/no question for one that starts with what or how."
      ),
      judged(
        "issue_discussed",
        3,
        "Was at least one issue actually discussed, beyond being listed?",
        "Issues were talked through, not just listed",
        "Take one issue and talk it through together."
      ),
      judged(
        "issue_toward_solution",
        4,
        "Was at least one issue worked toward a solution or a way forward?",
        "An issue was worked toward a solution",
        "Take an issue all the way to a way forward."
      ),
      judged(
        "good_open_questions",
        4,
        "Were there good open, curious questions that got the team thinking?",
        "Curious questions got the team thinking",
        "Ask one curious question before offering an answer."
      ),
      judged(
        "issues_prioritized",
        5,
        "Did the team choose which issue mattered most before working on issues?",
        "The team chose the issue that mattered most first",
        "Before solving any issue, ask which one would make the biggest difference this week."
      ),
      judged(
        "issue_reframed",
        5,
        "Was at least one issue reframed toward what the team wants, a possibility or an opportunity, rather than only what is wrong?",
        "An issue was reframed toward what the team wants",
        "Ask what better would look like before asking what to do."
      ),
      judged(
        "issue_to_commitment",
        5,
        "Did a worked issue end with a commitment that someone owns?",
        "A worked issue ended with a commitment someone owns",
        "Close each worked issue with who is doing what, by when."
      ),
      judged(
        "mostly_open_questions",
        5,
        "Were the questions asked mostly open and curious, rather than closed?",
        "Questions were mostly open and curious",
        "Lean on what and how questions through the whole meeting."
      ),
    ],
  },
  {
    key: "focus",
    name: "Focus and decisions",
    covers: "Keeping on track, avoiding politicking, reaching decisions.",
    checks: [
      judged(
        "something_decided",
        2,
        "Was at least one decision made in the meeting?",
        "The meeting reached decisions",
        "Close a topic with a clear decision."
      ),
      judged(
        "drift_not_frequent",
        3,
        "Did the meeting mostly avoid drifting off topic and politicking? Answer true unless drift or politicking happened often.",
        "The meeting mostly kept its focus",
        "When the conversation drifts, bring it back to the agenda.",
        false
      ),
      derived(
        "topics_mostly_closed",
        4,
        "count",
        ({ obs }) => atLeast(obs.topics, 0.5, (t) => t.outcome !== "open"),
        "Most topics closed with a clear outcome ({detail})",
        "Close each topic: decided, a small group to decide, or next week's agenda ({detail} this week)."
      ),
      judged(
        "mostly_on_track",
        4,
        "Did the meeting stay mostly on its agenda?",
        "The meeting stayed on its agenda",
        "Keep to the agenda, and park what does not fit.",
        false
      ),
      derived(
        "topics_all_closed",
        5,
        "count",
        ({ obs }) => every(obs.topics, (t) => t.outcome !== "open"),
        "Every topic closed with a decision, a small group, or a spot on the next agenda ({detail})",
        "As each topic ends, ask how it closes: decided, a small group, or next week ({detail} this week)."
      ),
      judged(
        "side_topics_parked",
        5,
        "Were side topics parked and any politicking redirected? Answer true if there were none.",
        "Side topics were parked for the right time",
        "Park side topics as they come up, so the meeting keeps its pace.",
        false
      ),
    ],
  },
  {
    key: "container",
    name: "Meeting container",
    covers: "Shared understanding; people feel seen, heard and understood; strengths and values named.",
    checks: [
      judged(
        "ideas_heard",
        2,
        "Were ideas generally heard before being challenged or dismissed?",
        "Ideas were heard",
        "Let each idea land before responding to it.",
        false
      ),
      judged(
        "asks_and_listens",
        3,
        "Did whoever led the meeting ask questions and generally listen before offering ideas or solutions?",
        "The meeting was led by asking and listening",
        "Ask and listen before offering an idea or a solution."
      ),
      judged(
        "validated_first",
        4,
        "Were ideas understood and validated before they were challenged?",
        "Ideas were understood before they were challenged",
        "Say back what you heard before challenging an idea."
      ),
      judged(
        "acknowledgments",
        4,
        "Were people acknowledged during the discussion for what they said or did?",
        "People were acknowledged during the discussion",
        "Acknowledge a good point as it is made."
      ),
      judged(
        "curious_most",
        4,
        "Did the meeting stay curious most of the time, with open questions that encouraged shared understanding?",
        "The meeting stayed curious",
        "Stay curious a little longer before moving to answers."
      ),
      judged(
        "everyone_invited",
        5,
        "Was dialogue encouraged from everyone, including quieter people?",
        "Everyone was invited into the conversation",
        "Invite a quieter voice in by name."
      ),
      judged(
        "strengths_named",
        5,
        "Was someone's individual strength called out?",
        "Someone's strength was named",
        "Name a person's strength when it shows."
      ),
      judged(
        "values_linked",
        5,
        "Was an action or decision linked to the team's values, named out loud or clearly implied?",
        "An action was linked to the team's values",
        "Link one choice to a team value out loud."
      ),
    ],
  },
  {
    key: "structure",
    name: "Structure",
    covers: "All parts of the meeting are covered.",
    checks: [
      derived(
        "sections_half",
        2,
        "count",
        (input) => {
          const n = sectionsCovered(input);
          return { met: n * 2 >= AGENDA_SECTIONS.length, detail: ofTotal(n, AGENDA_SECTIONS.length) };
        },
        "Most parts of the meeting were covered ({detail})",
        "Follow the meeting's agenda ({detail} parts this week)."
      ),
      derived(
        "sections_most",
        3,
        "count",
        (input) => {
          const n = sectionsCovered(input);
          return { met: n >= AGENDA_SECTIONS.length - 1, detail: ofTotal(n, AGENDA_SECTIONS.length) };
        },
        "Nearly every part of the meeting was covered ({detail})",
        `Cover each part: ${AGENDA_SECTIONS.map((s) => SECTION_NAMES[s]).join(", ")}.`
      ),
      derived(
        "sections_all",
        4,
        "count",
        (input) => {
          const n = sectionsCovered(input);
          return { met: n === AGENDA_SECTIONS.length, detail: ofTotal(n, AGENDA_SECTIONS.length) };
        },
        "Every part of the meeting was covered ({detail})",
        "Cover every part of the meeting ({detail} this week)."
      ),
      judged(
        "close_confirmed",
        5,
        "Did the meeting close by confirming decisions and commitments, or by pointing people to AiMS HQ to find them?",
        "The meeting closed by confirming what was agreed",
        "Close by confirming what was agreed, or point the team to AiMS HQ for it."
      ),
    ],
  },
  {
    key: "engagement",
    name: "Engagement",
    covers: "Level of participation and energy.",
    checks: [
      derived(
        "no_one_dominates",
        2,
        "count",
        ({ counts }) =>
          counts.speakers.length === 0
            ? { met: true, na: true }
            : {
                met: counts.topShare <= TOP_SHARE_LIMIT,
                detail: `${Math.round(counts.topShare * 100)}%`,
              },
        "The talking was shared; no one voice held the floor ({detail} at most)",
        "Leave more room for the team to talk (one voice held {detail} of it)."
      ),
      derived(
        "half_engaged",
        3,
        "count",
        ({ counts }) =>
          counts.attendees === 0
            ? { met: true, na: true }
            : { met: counts.engaged * 2 >= counts.attendees, detail: ofTotal(counts.engaged, counts.attendees) },
        "Many of the team took part ({detail})",
        "Bring more voices in ({detail} took a real part this week)."
      ),
      derived(
        "most_engaged",
        4,
        "count",
        ({ counts }) =>
          counts.attendees === 0
            ? { met: true, na: true }
            : { met: counts.engaged * 4 >= counts.attendees * 3, detail: ofTotal(counts.engaged, counts.attendees) },
        "Most of the team took part ({detail})",
        "Invite the quieter voices in ({detail} took a real part this week)."
      ),
      judged(
        "forward_energy",
        4,
        "Was the energy of the meeting focused on moving things forward?",
        "The energy went into moving things forward",
        "Point the energy at what happens next.",
        false
      ),
      derived(
        "all_engaged",
        5,
        "count",
        ({ counts }) =>
          counts.attendees === 0
            ? { met: true, na: true }
            : { met: counts.engaged >= counts.attendees, detail: ofTotal(counts.engaged, counts.attendees) },
        "Everyone took part ({detail})",
        "Bring every voice in ({detail} took a real part this week)."
      ),
      judged(
        "high_energy",
        5,
        "Was there clearly high engagement and energy from everyone?",
        "The whole room brought energy",
        "Ask for everyone's view on the topic that matters most.",
        false
      ),
    ],
  },
];

// Judged checks that are only read by a derived check, as a fallback
// or an alternative. They are asked, but not shown or scored on their
// own: the derived check carries the answer.
export const SUPPORTING_CHECKS = new Set([
  "headlines_everyone",
  "scorecard_full_said",
  "off_track_flagged_said",
  "operational_mentioned",
  "issues_identified_said",
]);

export function judgedChecks(): Array<Extract<RubricCheck, { kind: "judged" }>> {
  return RUBRIC.flatMap((p) => p.checks).filter(
    (c): c is Extract<RubricCheck, { kind: "judged" }> => c.kind === "judged"
  );
}
