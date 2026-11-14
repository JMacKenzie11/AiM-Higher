import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { loadCoachingPrinciples } from "@/lib/coach/principles";
import { COMMITMENT_DRAFT_BLOCK } from "@/lib/coach/commitment-draft";
import { VOICE_RULES_COACH } from "@/lib/coach/voice-rules";
import { GENERAL_MODE_PREAMBLE } from "@/lib/coach/general-preamble";
import { ATTACHMENT_PROMPT_NOTE } from "@/lib/coach/attachments";
import type { AgentRuntimeConfig } from "@/lib/practices/version-config";

// THE SYSTEM PROMPT EVERY COACH CONVERSATION STARTS FROM: the base
// (the coach prompt with the voice spliced in, or the voice alone for a
// voice_only agent), the plain-Aimee preamble or the agent's prompt,
// then the coaching principles, the commitment draft format and the
// voice rules. The route appends the per-person blocks after this.
// Nothing here may vary by the day: the result is the cached prefix.

// Takes the RESOLVED CONFIG, not a practice id.
//
// It used to re-resolve the agent from the registry, which is now
// the wrong source: a conversation runs on the version pinned to it,
// and the prompt may be stored text rather than a file on disk. The
// caller has already resolved that once for this turn, so passing it
// in also removes the second lookup.
//
// `config` is null for a plain Aimee or about-mode conversation.
export async function loadSystemPrompt(
  mode: "about" | "general",
  config: AgentRuntimeConfig | null
): Promise<string> {
  // A voice_only practice loads aims-voice.md alone as the base —
  // no coaching spine, no diagnostic modes, no patterns-to-watch-
  // for. Used by structural practices (chart builder, etc.) where
  // the practice prompt is the entire flow and inheriting the coach
  // spine would push it into diagnosis instead of the guided task.
  const base =
    config?.basePromptMode === "voice_only"
      ? await loadVoiceOnlyBase()
      : await loadCoachBase();

  // Practice sessions layer the agent's prompt AFTER the base. The
  // base establishes voice + stance; the agent narrows it into a
  // specific guided flow (including any card-block contract the
  // client renders). The two bases stay on disk and keep their SHA
  // guards — they are the fallback, so they matter more now, not
  // less.
  // Every agent can be handed files (lib/coach/attachments.ts).
  const composed = config
    ? `${base}\n\n${config.prompt}\n\n${ATTACHMENT_PROMPT_NOTE}`
    : mode === "about"
      ? base
      : `${GENERAL_MODE_PREAMBLE}\n\n${base}`;

  // The AiMS coaching principles come after the agent's prompt and
  // take precedence over it (lib/coach/principles.ts). Voice rules go
  // LAST so they're the freshest instruction the model reads before
  // generating. Both apply to every coach surface (about, general,
  // practice, panel): one way of coaching and one voice across the
  // whole product. The commitment draft's format follows the
  // principles, which say when to offer one (lib/coach/commitment-draft.ts).
  return `${composed}\n\n${await loadCoachingPrinciples()}\n\n${COMMITMENT_DRAFT_BLOCK}\n\n${VOICE_RULES_COACH}`;
}

// Load the base coach prompt by splicing prompts/aims-voice.md (the
// voice + language section) into prompts/leadership-coach.md at the
// {{AIMS_VOICE}} sentinel. The split is byte-preserving: recomposing
// the two files with this splice returns the original leadership-
// coach.md content unchanged. Regression is guarded by the SHA
// snapshot test in leadership-coach.compose.test.ts.
export async function loadCoachBase(): Promise<string> {
  const remainderPath = path.join(
    process.cwd(),
    "prompts",
    "leadership-coach.md"
  );
  const voicePath = path.join(process.cwd(), "prompts", "aims-voice.md");
  const [remainder, voice] = await Promise.all([
    fs.readFile(remainderPath, "utf8"),
    fs.readFile(voicePath, "utf8"),
  ]);
  return remainder.replace("{{AIMS_VOICE}}", voice);
}

// Voice-only base for practices that don't inherit the full
// coaching spine. Returns aims-voice.md verbatim; the practice
// prompt and VOICE_RULES_COACH still layer on around it via
// loadSystemPrompt.
async function loadVoiceOnlyBase(): Promise<string> {
  const voicePath = path.join(process.cwd(), "prompts", "aims-voice.md");
  return fs.readFile(voicePath, "utf8");
}
