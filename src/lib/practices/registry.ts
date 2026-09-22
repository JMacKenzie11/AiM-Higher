import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PracticeCategory } from "./categories";
import type { Role } from "@/lib/types";
import type { ModuleFeature } from "@/lib/subscriptions/service";

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
export type OutputCardName =
  | "ScriptCard"
  | "ChartProposalCard"
  | "RoleDescriptionCard";

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
  // firstTurn
  //   Controls what happens the moment an agent is attached to a
  //   thread (via the composer's Agent picker, a deep-link, or the
  //   /ask-aimee/new?agent= route):
  //   "scripted" — persist scriptedOpener as the first assistant
  //     message with zero API calls. Cheap, deterministic. Requires
  //     a scriptedOpener to be present.
  //   "generate" — call the model with the practice's system prompt
  //     and a synthetic "introduce yourself and start" instruction.
  //     Streams a fresh opener each time. More expressive; costs one
  //     Anthropic turn per selection. No scriptedOpener needed (any
  //     one that IS present is ignored — the prompt is authoritative).
  //   Omitted — no opener runs; the empty state renders as it does
  //     today for a plain Ask Aimee thread.
  firstTurn?: "scripted" | "generate";
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
  // tools
  //   Tools registered for THIS practice and nowhere else. The
  //   general coach's tool list is built by buildCoachTools and is
  //   unchanged; these are added on top when this practice is the
  //   one running.
  //
  //   Per-practice rather than global because a tool the model can
  //   always see is a tool it will sometimes reach for. The chart
  //   and the Foundation are the Role Description Builder's working
  //   material and nobody else's, and a coach that can list every
  //   function is a coach that will list every function.
  //
  //   String tags, not functions, so the registry stays
  //   serializable to the client components that render the picker.
  //   The route resolves them; an unknown tag is dropped rather
  //   than thrown, because a typo here should cost the agent a tool
  //   and not the conversation.
  tools?: readonly PracticeToolName[];
  // feature
  //   When present, the practice is hidden from the picker and its
  //   launch refused unless the scoped company has this feature.
  //   Absent means every company.
  //
  //   Added with the Role Description Creator, which had been
  //   DESCRIBED as feature-gated without being one: the card it
  //   writes to only renders for companies with role_descriptions,
  //   so a company without it could run the agent, press Save, and
  //   have the document land somewhere they cannot see.
  feature?: ModuleFeature;
  // alsoFunctionLeads
  //   Admits anybody who heads up a function on this company's
  //   chart, on top of allowedRoles. A seat's Lead is usually a
  //   team_member, and a role description is a description of their
  //   own seat, so a list of platform roles cannot express who
  //   should reach this. The relationship can: they lead a function.
  //
  //   The write it unlocks is narrower than the agent. A lead saves
  //   the document for the function THEY lead; RLS says so in 0222
  //   and saveRoleDescriptionAction says so before the database is
  //   asked.
  alsoFunctionLeads?: boolean;
};

// The tool sets a practice may declare. Adding one means adding a
// builder to the resolver in the coach route.
export type PracticeToolName = "get_foundation" | "list_functions";

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
  {
    id: "functional-chart-builder",
    title: "Functional Chart Builder",
    description:
      "Build a clear accountability chart: the functions your business needs, before the people who fill them.",
    category: "People",
    promptFile: "prompts/practices/functional-chart-builder.md",
    chips: ["I need to create my functional chart"],
    basePromptMode: "voice_only",
    skipSetup: false,
    allowedRoles: ["company_admin", "system_admin", "aims_guide"],
    outputCard: { chart_proposal: "ChartProposalCard" },
  },
  {
    id: "role-description",
    title: "Role Description Creator",
    description:
      "Create downloadable role descriptions that integrate company context like industry, and organizational culture.",
    category: "People",
    promptFile: "prompts/practices/role-description.md",
    // Two chips, because the second is a whole path the leader
    // would otherwise have to discover by answering "no" to the
    // first. A role that is not on the chart is a first-class case,
    // not an exception.
    chips: [
      "Write a role description for a seat on our Functional Chart",
      "Write a role description for a role that is not on the chart",
    ],
    basePromptMode: "voice_only",
    skipSetup: true,
    allowedRoles: ["company_admin", "system_admin", "aims_guide"],
    tools: ["get_foundation", "list_functions"],
    // NOT feature-gated. role_descriptions gates the surfaces this
    // agent replaced — decision rights, competency indicators, the
    // generator page — and that flag is being switched off fleet-
    // wide (0223). Tying the agent to it would take the agent down
    // with them. Who can reach it is a question about the person:
    // the three roles below, plus anyone who heads up a function.
    alsoFunctionLeads: true,
    outputCard: { role_description: "RoleDescriptionCard" },
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
