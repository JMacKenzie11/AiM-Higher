import { DATE_RULE } from "./rubric";
import type { RubricFacts } from "./types";

// What this meeting committed to and raised, from the extraction in
// hand, added to the facts the readings were given. The readings never
// see these: only code's checks read them, so they can arrive after the
// readings have started.
export function withThisMeeting(
  facts: RubricFacts,
  meeting: {
    commitments: Array<{
      owner_profile_id: string | null;
      priority_id?: string | null;
      due_phrase?: string | null;
      description: string;
    }>;
    issues: number;
  }
): RubricFacts {
  return {
    ...facts,
    newCommitments: meeting.commitments.map((c) => ({
      description: c.description,
      hasOwner: c.owner_profile_id !== null,
      // Every extracted commitment has a date: a named day, or "By next
      // meeting" when none was said, which counts (DATE_RULE).
      dateNamed: DATE_RULE.nextMeetingCountsAsDate || !!c.due_phrase,
      linkedToPriority: !!c.priority_id,
    })),
    issuesRaised: meeting.issues,
  };
}
