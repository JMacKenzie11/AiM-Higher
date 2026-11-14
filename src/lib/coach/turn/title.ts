import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { callSettings } from "@/lib/transcripts/model";
import { logCoachTokenUsage } from "@/lib/coach/usage";
import { reportError } from "@/lib/observability/report";
import { cleanGeneratedTitle, TITLE_SYSTEM } from "@/lib/coach/title";
import { isDefaultTitle } from "@/lib/coach/default-title";
import { textOf } from "./anthropic";

export async function generateTitleForConversation(args: {
  client: Anthropic;
  model: string;
  messages: Anthropic.MessageParam[];
  assistantText: string;
  conversationId: string;
  companyId: string | null;
  currentUserId: string;
  signal?: AbortSignal;
  // The request's own client, made while the request was live. The
  // label lands after the reply has finished, and a client made then
  // reads cookies outside the request, which Next refuses ("used
  // cookies inside after"): the write threw, the catch below swallowed
  // it, and the conversation kept its date title. On production 7 of
  // the 10 plain Aimee conversations started since 1 Nov 2026 still
  // had "Coaching · <date>" (Jason, 2026-11-13).
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}): Promise<void> {
  try {
    const followup: Anthropic.MessageParam[] = [
      ...args.messages,
      { role: "assistant", content: args.assistantText },
      {
        role: "user",
        content:
          "Give this conversation a four-word topic label. Reply with the label only, as plain text — no punctuation, no quotes, no markdown formatting (no asterisks, underscores, backticks, or hash marks).",
      },
    ];
    const response = await args.client.messages.create(
      {
        model: args.model,
        max_tokens: 64,
        ...callSettings(args.model, "off"),
        messages: followup,
        system: TITLE_SYSTEM,
      },
      { signal: args.signal }
    );
    // Log title-generation cost before we branch on success.
    if (response.usage) {
      void logCoachTokenUsage({
        conversationId: args.conversationId,
        companyId: args.companyId,
        purpose: "title",
        model: args.model,
        usage: response.usage,
      });
    }
    const label = cleanGeneratedTitle(textOf(response.content)).slice(0, 80);
    if (!label) return;
    // A name the person gave the conversation while this reply was
    // arriving is theirs; only a default title is replaced.
    const { data: current } = await args.supabase
      .from("coaching_conversations")
      .select("title")
      .eq("id", args.conversationId)
      .maybeSingle<{ title: string | null }>();
    if (current && !isDefaultTitle(current.title)) return;
    const { error } = await args.supabase
      .from("coaching_conversations")
      .update({ title: label })
      .eq("id", args.conversationId);
    if (error) {
      console.error(`[coach] title not saved for ${args.conversationId}:`, error.message);
      reportError("coach.title_not_saved", error, { conversationId: args.conversationId });
    }
  } catch (err) {
    if (!args.signal?.aborted) {
      console.error(`[coach] title failed for ${args.conversationId}:`, err instanceof Error ? err.message : err);
    }
    // Silent — the default date title stays.
  }
}
