import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PracticeCategory } from "./categories";
import type { Role } from "@/lib/types";

// Practices are prompt modules layered onto the existing coaching
// infrastructure. Same chat UI, same streaming, same tools, same
// privacy model. Adding a practice is a registry entry plus a prompt
// file at the referenced path — no other code changes required.
//
// Every practice ships with:
//   * a stable id used as the DB value and URL/registry key
//   * a title for cards, chips, and the muted prefix in the list
//   * a one-sentence description used on the entry card
//   * a promptFile path (relative to repo root) — appended verbatim
//     to the base leadership coach prompt when this practice runs
//   * optional opening chips shown on the empty-chat setup step
//
// The registry is a plain typed array so it can be imported from
// both server components (prompt assembly) and passed as JSON to
// client components (entry cards, chip lists).

// Re-export categories so consumers that already import from this
// module keep working; new code can import from ./categories directly
// when only categories are needed (client components should, to avoid
// pulling in server-only fs code).
export { PRACTICE_CATEGORIES } from "./categories";
export type { PracticeCategory } from "./categories";

// Card renderers are wired by a small string-keyed lookup in the
// chat view (see ChatView.tsx). Keeping outputCard values as string
// tags rather than component references means the registry can be
// serialized to a client component without losing shape.
export type OutputCardName = "ScriptCard" | "ChartProposalCard";

export type Practice = {
  id: string;
  title: string;
  description: string;
  category: PracticeCategory;
  promptFile: string;
  chips?: readonly string[];
  // ---- Assembly + launch behavior (added when the third practice
  // introduced the need for a voice-only base, a scripted opener,
  // and a role gate). Every existing practice declares these
  // explicitly rather than relying on defaults so the registry
  // reads as a full contract at a glance.
  //
  // basePromptMode
  //   "full_coach" — the current behavior: aims-voice.md is spliced
  //   into leadership-coach.md so the practice runs on top of the
  //   full coaching spine + diagnostic modes + patterns.
  //   "voice_only" — only aims-voice.md is loaded as the base. Use
  //   when the practice is a guided flow that shouldn't inherit
  //   the coach's diagnostic escalation, spine steps, or patterns-
  //   to-watch-for content (e.g., a structural chart builder).
  basePromptMode: "full_coach" | "voice_only";
  // skipSetup
  //   When true, launching the practice bypasses the partner picker
  //   and the empty-chat setup step; the conversation opens with
  //   the scriptedOpener (if any) already showing.
  skipSetup: boolean;
  // scriptedOpener
  //   When present, launching the practice persists this string as
  //   the first assistant message with NO API call. The model sees
  //   it in history from turn two onward. Kept in the registry so
  //   the opener is versioned alongside the prompt file.
  scriptedOpener?: string;
  // allowedRoles
  //   When present, the practice card is hidden from and the launch
  //   URL rejects anyone whose role isn't in the list. For aims_guide
  //   the launcher additionally checks the caller has an assignment
  //   to the scoped company; unscoped guides fall to the same denial.
  //   Absent means all members.
  allowedRoles?: readonly Role[];
  // outputCard
  //   Maps a fenced-block tag emitted by the practice prompt to the
  //   card renderer that consumes it. Absent means no card
  //   integration (plain text turns).
  outputCard?: Readonly<Record<string, OutputCardName>>;
};

export const PRACTICES: readonly Practice[] = [
  {
    id: "prepare-a-hard-conversation",
    title: "Prepare a hard conversation",
    description:
      "Address issues in a way that invites dialogue instead of defensiveness.",
    category: "Communication",
    promptFile: "prompts/practices/prepare-a-hard-conversation.md",
    chips: [
      "Someone isn't following through",
      "Something's off between us",
      "I need to reset expectations",
    ],
    basePromptMode: "full_coach",
    skipSetup: false,
    outputCard: { script: "ScriptCard" },
  },
  {
    id: "navigate-emotionally-charged-conversation",
    title: "Navigate an emotionally charged conversation",
    description:
      "Handle a moment where someone is upset or reactive so they feel heard, using the LEAD Model.",
    category: "Communication",
    promptFile:
      "prompts/practices/navigate-emotionally-charged-conversation.md",
    chips: [
      "Someone on my team gets easily upset",
      "I keep making things worse when they're stressed",
      "I need to talk to someone who's already frustrated",
    ],
    basePromptMode: "full_coach",
    skipSetup: false,
    outputCard: { script: "ScriptCard" },
  },
  {
    id: "ask-better-questions",
    title: "Ask great questions",
    description:
      "Create generative questions that open up thinking and invite ownership.",
    category: "Facilitation",
    promptFile: "prompts/practices/ask-better-questions.md",
    chips: [
      "I have a conversation to prepare for",
      "I'm stuck on a limiting question",
      "Show me examples for a topic",
    ],
    basePromptMode: "full_coach",
    skipSetup: false,
  },
] as const;

export function findPractice(id: string | null | undefined): Practice | null {
  if (!id) return null;
  return PRACTICES.find((p) => p.id === id) ?? null;
}

// Read the practice's prompt file from disk at request time. Kept
// as a small helper so prompt assembly stays declarative and the
// file-system dependency is localized here. Missing files throw so
// a bad registry entry surfaces loud instead of silently degrading
// the session to an unguided coach.
export async function loadPracticePrompt(practice: Practice): Promise<string> {
  const absolute = path.join(process.cwd(), practice.promptFile);
  const text = await fs.readFile(absolute, "utf8");
  return text.trim();
}
