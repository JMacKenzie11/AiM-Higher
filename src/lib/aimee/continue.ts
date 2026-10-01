import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { createGeneralConversation } from "@/lib/coach/create-general";
import { logCoachTokenUsage } from "@/lib/coach/usage";
import { findBannedPhrases, retryInstruction } from "@/lib/voice/banned";
import { findUnsupportedQuotes, quoteRetryInstruction } from "@/lib/voice/quotes";
import { stripEmDashes } from "@/lib/voice/strip-dashes";

// "CONTINUE ON THE AIMEE PAGE", CARRYING THE PANEL CONVERSATION OVER.
//
// When a panel conversation turns into coaching, Aimee offers a link
// to a NEW conversation on the Aimee page (lib/aimee/panel.ts). The new
// one opens with a short summary of what the person said in the panel,
// shown as Aimee's first message, so they do not have to say it again.
//
// ---- WHAT IS READ, AND AS WHOM --------------------------------------
//
// The panel conversation is read under the person's own session, and
// only if it is theirs, started in the panel, and plain Aimee. Anything
// else, including an id that is not theirs, gets an ordinary new
// conversation: the link cannot be pointed at somebody else's thread.
//
// Only the PERSON's messages go to the model. The summary is of what
// they said, and quotes are checked against their words alone.
//
// ---- MEMORY (Jason, 2026-09-29) -------------------------------------
//
// The new conversation is an ordinary Aimee-page conversation, so the
// sweep can later distil it, summary included. That is the one way
// anything from the panel reaches memory, and only because the person
// chose to continue where memory works.
//
// ---- CHECKED BEFORE IT IS SHOWN -------------------------------------
//
// Like an invitation line or a debrief reply: banned phrases and
// quotes they never said send it back once with what was wrong; em
// dashes are replaced. If the second attempt still breaks a rule, or
// the call fails, the conversation opens without a summary rather
// than with a bad one.

const PROMPT_PATH = path.join(process.cwd(), "prompts", "panel-continue.md");
// The house voice, including the banned phrases the prompt refers to.
const VOICE_PATH = path.join(process.cwd(), "prompts", "aims-voice.md");
const MODEL = "claude-sonnet-5";
const MAX_MESSAGES = 40;

// Only a uuid reaches a query; anything else is an ordinary new
// conversation.
export function isConversationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export type ContinueResult = { ok: true; conversationId: string; summarized: boolean } | { ok: false; message: string };

type Faults = { count: number; instruction: string };

export function checkContinueOpener(text: string, personSaid: string): Faults {
  const banned = findBannedPhrases(text);
  const invented = findUnsupportedQuotes(text, personSaid);
  return {
    count: banned.length + invented.length,
    instruction: [
      invented.length > 0 ? quoteRetryInstruction(invented) : null,
      banned.length > 0 ? retryInstruction(banned) : null,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export async function continueFromPanel(panelConversationId: string): Promise<ContinueResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: source } = await supabase
    .from("coaching_conversations")
    .select("id, created_by, origin, mode, practice_id")
    .eq("id", panelConversationId)
    .maybeSingle<{ id: string; created_by: string; origin: string; mode: string; practice_id: string | null }>();
  const eligible =
    source &&
    source.created_by === session.profile.id &&
    source.origin === "panel" &&
    source.mode === "general" &&
    !source.practice_id;

  const personSaid = eligible ? await personMessages(supabase, panelConversationId) : "";

  const created = await createGeneralConversation();
  if (!created.ok) return created;
  const conversationId = created.item.id;
  if (!personSaid) return { ok: true, conversationId, summarized: false };

  const opener = await writeOpener(personSaid, conversationId, created.item.company_id);
  if (!opener) return { ok: true, conversationId, summarized: false };

  const { error } = await supabase.from("coaching_messages").insert({
    conversation_id: conversationId,
    created_by: session.profile.id,
    role: "assistant",
    content: opener,
  });
  if (error) {
    console.error("[aimee] continue: opener not saved", error.message);
    return { ok: true, conversationId, summarized: false };
  }
  return { ok: true, conversationId, summarized: true };
}

async function personMessages(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  conversationId: string
): Promise<string> {
  const { data } = await supabase
    .from("coaching_messages")
    .select("content, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);
  return ((data ?? []) as Array<{ content: string }>)
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

async function writeOpener(personSaid: string, conversationId: string, companyId: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const system = `${await readFile(PROMPT_PATH, "utf8")}\n\n${await readFile(VOICE_PATH, "utf8")}`;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const ask = `What they said in the panel, in order:\n\n${personSaid}`;
  let instruction = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        // Off, as for the Guide's headline. Left to its default the
        // model can spend every token of a short budget thinking and
        // return no text, and the conversation opens without its
        // summary (seen on dev with the debrief drafts, 2026-09-29).
        thinking: { type: "disabled" },
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: instruction ? `${ask}\n\n${instruction}` : ask }],
      });
      if (response.usage) {
        // A turn of the NEW conversation: it is that conversation's
        // opening, and counts toward what that conversation cost.
        void logCoachTokenUsage({ conversationId, companyId, purpose: "turn", model: MODEL, usage: response.usage });
      }
      const text = stripEmDashes(
        response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim()
      );
      if (!text) continue;
      const faults = checkContinueOpener(text, personSaid);
      if (faults.count === 0) return text;
      instruction = faults.instruction;
      console.warn("[aimee] continue: opener sent back", { attempt, faults: faults.count });
    } catch (err) {
      console.error("[aimee] continue: summary failed", err instanceof Error ? err.message : String(err));
      return null;
    }
  }
  return null;
}
