import { stripEmDashes } from "@/lib/voice/strip-dashes";
import { findBannedPhrases } from "@/lib/voice/banned";
import { findPersonalDetail } from "@/lib/voice/personal-detail";
import { findDenials } from "./narrative";
import { CONVERSATION_GUIDE, QUESTION_LABELS } from "./conversation-guide";

export { CONVERSATION_GUIDE, QUESTION_LABELS };

// RUN A CAPACITY CONVERSATION (phase 3). The helper the lead uses during
// one person's conversation, on the Conversations step and nowhere else
// (Jason, 2026-10-22: it lives inside the diagnostic, not in the Agent
// Hub or any picker). It walks the five questions: the lead types what
// the person said, the words go into that person's notes as typed, and
// the helper offers one follow-up question or says the answer is enough
// to move on. At the end it offers the two short fields from questions
// 1 and 5. Nothing it writes reaches the notes body; only the person's
// words do, so the quote checks still hold them to what was said.

export const MAX_SAID = 4000;

export type Exchange = { question: number; said: string };

export const CONVERSATION_SCHEMA = {
  type: "object",
  properties: {
    follow_up: { type: "string", description: "One short follow-up question for the lead to ask, or an empty string when the answer is enough to move on." },
    move_on: { type: "boolean", description: "True when the answer covers the question well enough to go to the next one." },
    peak_experience: { type: "string", description: "Their best work in one line, from question 1, in their words where possible. Empty until they have said it." },
    redeploy_wish: { type: "string", description: "Where they would put a few hours back, in one line, from question 5, in their words where possible. Empty until they have said it." },
  },
  required: ["follow_up", "move_on", "peak_experience", "redeploy_wish"],
};

export type Turn = { followUp: string | null; moveOn: boolean; peakExperience: string | null; redeployWish: string | null };

function line(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = stripEmDashes(v).replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
}

// What the helper's answer may put in front of the lead. A follow-up
// that pries into private life or breaks the voice rules is dropped
// rather than shown, and the lead moves on with the guide.
export function checkTurn(data: unknown): Turn {
  const d = (data ?? {}) as Record<string, unknown>;
  const clean = (v: unknown, max: number) => {
    const t = line(v, max);
    if (!t) return null;
    if (findPersonalDetail(t, { mode: "moment" }).length || findBannedPhrases(t).length || findDenials(t).length) return null;
    return t;
  };
  let followUp = clean(d.follow_up, 300);
  if (followUp && !followUp.endsWith("?")) followUp = null;
  return {
    followUp,
    moveOn: d.move_on === true || !followUp,
    peakExperience: clean(d.peak_experience, 300),
    redeployWish: clean(d.redeploy_wish, 300),
  };
}

// The person's words, added to their notes under the question's
// heading. The heading goes in once, the first time that question gets
// an answer, so a follow-up's answer runs on beneath it.
export function notesWithAnswer(body: string, question: number, said: string): string {
  const words = said.trim();
  if (!words) return body;
  const heading = `${question + 1}. ${QUESTION_LABELS[question]}`;
  const lines = body.split("\n");
  const headed = lines.some((l) => l.trim() === heading);
  const base = body.trimEnd();
  if (headed) return `${base}\n${words}`;
  return base ? `${base}\n\n${heading}\n${words}` : `${heading}\n${words}`;
}

// The model's input: the guide, the question being asked, and what
// the person has said so far, by question.
export function conversationInput(question: number, exchanges: readonly Exchange[], role: string | null): string {
  return JSON.stringify({
    their_role: role ?? "Team member",
    the_five_questions: CONVERSATION_GUIDE,
    question_being_asked: { number: question + 1, text: CONVERSATION_GUIDE[question] },
    what_they_have_said: exchanges.map((e) => ({ question: e.question + 1, said: e.said })),
  });
}

// The answers so far, read back out of the notes by their headings, so
// the helper sees what the notes hold, typed edits included.
export function exchangesIn(body: string): Exchange[] {
  const out: Exchange[] = [];
  let current: Exchange | null = null;
  for (const line of body.split("\n")) {
    const m = /^([1-5])\. /.exec(line.trim());
    if (m && line.trim() === `${m[1]}. ${QUESTION_LABELS[Number(m[1]) - 1]}`) {
      current = { question: Number(m[1]) - 1, said: "" };
      out.push(current);
    } else if (current && line.trim()) {
      current.said = current.said ? `${current.said}\n${line.trim()}` : line.trim();
    }
  }
  return out.filter((e) => e.said);
}
