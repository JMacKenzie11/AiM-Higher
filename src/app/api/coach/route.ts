import "server-only";

import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildCoachContext } from "@/lib/coach/context";
import type {
  CoachingConversation,
  CoachingMessage,
} from "@/lib/coach/service";

// POST /api/coach — streaming chat endpoint for the coaching feature.
//
// Wire behaviour:
//   1. Verify the caller can write to this conversation (RLS + role).
//   2. Persist the user message BEFORE calling the model so the
//      admin's typed message survives an API failure.
//   3. Assemble the fresh context blocks (company + person + coaching)
//      and prepend them to the running message history.
//   4. Stream the Anthropic response to the client via SSE.
//   5. On stream end, persist the complete assistant message.
//   6. If the assembly or API call fails, surface an inline error
//      event; do NOT rewrite or discard the user's message.
//
// Prompt caching: the static leadership-coach.md content lives in the
// system prompt with a cache breakpoint so re-sends inside a
// conversation hit the cache. The dynamic context blocks live in a
// leading user message, which stays uncached (changes every turn).

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // Node runtime for fs + Anthropic streaming.

type IncomingBody = {
  conversationId?: unknown;
  userMessage?: unknown;
  // When true, don't persist a new user_message row; use the last
  // stored user message as the prompt. This is the retry path — the
  // admin's original message survived the API failure and is already
  // in the DB, so we mustn't insert a duplicate.
  retry?: unknown;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2000;

function encodeEvent(event: string, data: unknown): Uint8Array {
  const payload =
    typeof data === "string" ? data : JSON.stringify(data);
  return new TextEncoder().encode(`event: ${event}\ndata: ${payload}\n\n`);
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await requireProfile();

  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : "";
  const userMessage =
    typeof body.userMessage === "string" ? body.userMessage.trim() : "";
  const isRetry = body.retry === true;
  if (!conversationId || (!isRetry && !userMessage)) {
    return new Response("Missing conversationId or userMessage", {
      status: 400,
    });
  }

  const supabase = await createSupabaseServerClient();
  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle<CoachingConversation>();
  if (!convo) {
    return new Response("Conversation not found", { status: 404 });
  }
  // Belt-and-braces alongside RLS: only the creator writes here.
  if (convo.created_by !== session.profile.id) {
    return new Response("Forbidden", { status: 403 });
  }

  // Persist the user message immediately so it can't be lost if the
  // API call below fails. On retry the row already exists — reuse it.
  let userRow: CoachingMessage | null = null;
  if (isRetry) {
    const { data: last } = await supabase
      .from("coaching_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<CoachingMessage>();
    if (!last) {
      return new Response("No user message to retry", { status: 400 });
    }
    userRow = last;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("coaching_messages")
      .insert({
        conversation_id: conversationId,
        created_by: session.profile.id,
        role: "user",
        content: userMessage,
      })
      .select("*")
      .single<CoachingMessage>();
    if (insertError || !inserted) {
      return new Response("Couldn't save your message", { status: 500 });
    }
    userRow = inserted;
  }

  // Load the full turn-by-turn history (including the row we just
  // inserted) so the model sees the same thread the UI shows.
  const { data: allMessages } = await supabase
    .from("coaching_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const history = (allMessages ?? []) as CoachingMessage[];

  const isFirstExchange =
    history.filter((m) => m.role === "user").length === 1 &&
    history.filter((m) => m.role === "assistant").length === 0;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return streamErrorResponse(
      "Coach isn't configured yet — ANTHROPIC_API_KEY is missing on the server."
    );
  }
  const model = process.env.ANTHROPIC_COACH_MODEL || DEFAULT_MODEL;

  const [systemPromptText, context] = await Promise.all([
    loadSystemPrompt(),
    buildCoachContext({
      companyId: convo.company_id,
      subjectProfileId: convo.subject_profile_id,
      currentAdminName: session.profile.full_name,
      currentAdminProfileId: session.profile.id,
    }),
  ]);

  const client = new Anthropic({ apiKey });
  const userTurnPrefix = `${context.companyContext}\n\n${context.personContext}\n\n${context.coachingContext}\n\n`;
  const messages = buildMessages(history, userTurnPrefix);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encodeEvent("ready", { userMessageId: userRow.id }));

        const messageStream = client.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system: [
            {
              type: "text",
              text: systemPromptText,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages,
        });

        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encodeEvent("delta", { text: event.delta.text })
            );
          }
        }

        const final = await messageStream.finalMessage();
        const assistantText = final.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        const { data: assistantRow } = await supabase
          .from("coaching_messages")
          .insert({
            conversation_id: conversationId,
            created_by: session.profile.id,
            role: "assistant",
            content: assistantText,
          })
          .select("*")
          .single<CoachingMessage>();

        // Bump updated_at so the list view re-sorts.
        await supabase
          .from("coaching_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);

        controller.enqueue(
          encodeEvent("done", {
            assistantMessageId: assistantRow?.id ?? null,
            usage: final.usage,
          })
        );

        // Fire-and-forget title generation after the first exchange.
        if (isFirstExchange) {
          void generateTitleForConversation({
            client,
            model,
            systemPromptText,
            messages,
            assistantText,
            conversationId,
            currentUserId: session.profile.id,
          });
        }

        controller.close();
      } catch (error) {
        const message =
          error instanceof Anthropic.APIError
            ? `Claude API error (${error.status}): ${error.message}`
            : error instanceof Error
            ? error.message
            : "Something went wrong.";
        try {
          controller.enqueue(encodeEvent("error", { message }));
        } catch {
          // Controller may already be closed.
        }
        try {
          controller.close();
        } catch {
          // Ignore duplicate close.
        }
        // Bump updated_at so the list view still moves — helps the
        // admin find the failed thread again to retry.
        void supabase
          .from("coaching_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}

// ---- Helpers ----------------------------------------------------

async function loadSystemPrompt(): Promise<string> {
  const filePath = path.join(process.cwd(), "prompts", "leadership-coach.md");
  return fs.readFile(filePath, "utf8");
}

function buildMessages(
  history: CoachingMessage[],
  contextPrefix: string
): Anthropic.MessageParam[] {
  // The dynamic <company_context>/<person_context>/<coaching_context>
  // block is prepended to the LATEST user message only. Prepending
  // context to a stable earlier turn would keep growing the token
  // count without any benefit, and would blow the prompt cache too.
  const messages: Anthropic.MessageParam[] = [];
  history.forEach((m, idx) => {
    const isLast = idx === history.length - 1;
    if (m.role === "user" && isLast) {
      messages.push({
        role: "user",
        content: `${contextPrefix}${m.content}`,
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  });
  return messages;
}

function streamErrorResponse(message: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeEvent("error", { message }));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
    },
  });
}

// After the first exchange completes, ask the model for a compact
// four-word label and write it to the conversation title. Non-blocking
// on the main response; failures are swallowed silently (the default
// date title is still perfectly usable).
async function generateTitleForConversation(args: {
  client: Anthropic;
  model: string;
  systemPromptText: string;
  messages: Anthropic.MessageParam[];
  assistantText: string;
  conversationId: string;
  currentUserId: string;
}): Promise<void> {
  try {
    const followup: Anthropic.MessageParam[] = [
      ...args.messages,
      { role: "assistant", content: args.assistantText },
      {
        role: "user",
        content:
          "Give this conversation a four-word topic label. Reply with the label only, no punctuation.",
      },
    ];
    const response = await args.client.messages.create({
      model: args.model,
      max_tokens: 64,
      messages: followup,
      system: [
        {
          type: "text",
          text: args.systemPromptText,
          cache_control: { type: "ephemeral" },
        },
      ],
    });
    const label = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/[".]+$/g, "")
      .slice(0, 80);
    if (!label) return;
    const supabase = await createSupabaseServerClient();
    await supabase
      .from("coaching_conversations")
      .update({ title: label })
      .eq("id", args.conversationId);
  } catch {
    // Silent — the default date title stays.
  }
}
