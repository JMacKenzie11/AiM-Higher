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
// skill file (prompts/skills/commitment-draft.md) says how to write it.

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

// How Aimee writes the block is her commitment_draft skill,
// prompts/skills/commitment-draft.md (Jason, 2026-11-26), loaded when
// the leader says yes. The principles say when to offer one.
