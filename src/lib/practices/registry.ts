import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

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

export type Practice = {
  id: string;
  title: string;
  description: string;
  promptFile: string;
  chips?: readonly string[];
};

export const PRACTICES: readonly Practice[] = [
  {
    id: "prepare-a-hard-conversation",
    title: "Prepare a hard conversation",
    description:
      "Address issues in a way that invites dialogue instead of defensiveness.",
    promptFile: "prompts/practices/prepare-a-hard-conversation.md",
    chips: [
      "Someone isn't following through",
      "Something's off between us",
      "I need to reset expectations",
    ],
  },
  {
    id: "ask-better-questions",
    title: "Ask great questions",
    description:
      "Create generative questions that open up thinking and invite ownership.",
    promptFile: "prompts/practices/ask-better-questions.md",
    chips: [
      "I have a conversation to prepare for",
      "I'm stuck on a limiting question",
      "Show me examples for a topic",
    ],
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
