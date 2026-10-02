// AIMEE'S COMMITMENT DRAFT (coaching principles project, part 3; Jason,
// 2026-10-02).
//
// The principles end the coaching loop with "Say the step back in one
// sentence and offer to draft it as a commitment by their next meeting.
// Draft it only when they say yes. They see the draft and confirm it
// before anything is saved." This is the drafting half: the block Aimee
// writes, and what it parses to. The card (CommitmentDraftCard) shows
// it, and the save is the leader's, through the same create the
// Commitments page uses (commitments/create.ts).
//
// No imports: the chat (a client component) parses with it, and the
// route puts COMMITMENT_DRAFT_BLOCK in every system prompt.

export const COMMITMENT_DRAFT_TAG = "commitment";

export type CommitmentDraft = {
  // The step, as something they will do.
  description: string;
  // A day they named, YYYY-MM-DD. Null: due by their next meeting.
  dueDate: string | null;
};

const DESCRIPTION_MAX = 300;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Null while the block is still arriving, or if what arrived is not a
// draft: the card says so rather than showing braces.
export function parseCommitmentDraft(raw: string): CommitmentDraft | null {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as { description?: unknown; due_date?: unknown };
  if (typeof v.description !== "string") return null;
  const description = v.description.trim().slice(0, DESCRIPTION_MAX);
  if (!description) return null;
  const dueDate = typeof v.due_date === "string" && ISO_DATE.test(v.due_date) ? v.due_date : null;
  return { description, dueDate };
}

// In every Aimee system prompt, after the principles. The principles
// say when; this says how, and that the save is theirs.
export const COMMITMENT_DRAFT_BLOCK = `How to draft a commitment:

When the leader says yes to drafting their step as a commitment, reply with one short sentence and then the draft, as a fenced block tagged ${COMMITMENT_DRAFT_TAG}, and nothing after it:

\`\`\`${COMMITMENT_DRAFT_TAG}
{"description": "Ask the team at Monday's meeting what made the pricing discussion work", "due_date": null}
\`\`\`

"description" is the step in their words, as something they will do, starting with a verb, in one sentence and without a full stop. "due_date" is null unless they named a day; then it is that day as YYYY-MM-DD, worked out from today's date. With null, the commitment is due by their next meeting.

Write the block only after they say yes, and only once for a step. The draft is the leader's own commitment: never draft one for someone else. The leader sees it as a card, can change it, and saves it themselves, so never say it is saved or added. If they ask for a change, write the whole block again with the change.`;
