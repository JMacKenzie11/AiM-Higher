import "server-only";

import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildCoachContext } from "@/lib/coach/context";
import { buildCoachTools } from "@/lib/coach/tools";
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
// Cap on the number of tool-loop iterations per user turn. Each
// iteration = one Anthropic call that may end in either a natural
// stop or a tool_use. The cap prevents a misbehaving prompt from
// looping tools indefinitely.
const MAX_TOOL_ITERATIONS = 4;

function encodeEvent(event: string, data: unknown): Uint8Array {
  const payload =
    typeof data === "string" ? data : JSON.stringify(data);
  return new TextEncoder().encode(`event: ${event}\ndata: ${payload}\n\n`);
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await requireProfile();
  // req.signal fires when the client disconnects (tab closed, nav away,
  // fetch abort). Threading it into every Anthropic call means an
  // abandoned request stops burning tokens instead of streaming to
  // completion into a dead connection.
  const abortSignal = req.signal;

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

  // Load the turn-by-turn history so the model sees the same thread
  // the UI shows. Only role + content leave the DB — id, created_by,
  // and timestamps aren't part of the prompt and shipping them was
  // ~40% of the payload weight. We also cap the window so a long
  // thread can't grow the request-time payload (and the model's
  // token budget) without bound; older turns drop off, but the
  // company/person context is re-injected every send and grounds
  // the model regardless.
  const HISTORY_LIMIT = 200;
  const { data: recentRows } = await supabase
    .from("coaching_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = (recentRows ?? [])
    .slice()
    .reverse() as Array<Pick<CoachingMessage, "role" | "content">>;

  // First exchange = the one user row we just inserted, no assistant
  // row yet. When the cap is reached this is trivially false; when
  // it isn't, the counts match the true totals.
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

  // Build context. In general mode (Ask Aimee) there is no subject,
  // so person / strengths context are absent and the system prompt
  // gets an Aimee preamble. In about mode the standard leadership
  // prompt runs against subject-scoped context.
  const context = await buildCoachContext({
    companyId: convo.company_id,
    subjectProfileId: convo.subject_profile_id,
    currentAdminName: session.profile.full_name,
    currentAdminProfileId: session.profile.id,
    contextKind: convo.context_kind,
  });
  const systemPromptText = await loadSystemPrompt(convo.mode);

  const client = new Anthropic({ apiKey });
  const personBlock = context.personContext ? `${context.personContext}\n\n` : "";
  const strengthsBlock = context.strengthsContext ? `${context.strengthsContext}\n\n` : "";
  const userTurnPrefix = `${context.companyContext}\n\n${personBlock}${strengthsBlock}${context.coachingContext}\n\n`;
  const messages = buildMessages(history, userTurnPrefix);

  // Tool gating: subject-scoped tools are ONLY registered when there
  // is a subject to scope them to. In general mode the tool list is
  // empty — Aimee has no subject data to query and must not appear to.
  // Subject-scoped tools (strengths) only register in "about" mode.
  // Company-scoped tools (classroom) register in both modes provided
  // the feature is on — Aimee can recommend a training in Ask Aimee
  // conversations too. buildCoachTools handles the branch.
  const tools = await buildCoachTools({
    subjectProfileId:
      convo.mode === "about" ? convo.subject_profile_id ?? null : null,
    companyId: convo.company_id,
  });
  const toolDefs = tools.map((t) => t.definition);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encodeEvent("ready", { userMessageId: userRow.id }));

        // Tool loop. Each iteration streams one Anthropic response;
        // if it ends in tool_use we execute the tools, append the
        // assistant + tool_result turns to the running messages, and
        // loop. Otherwise we're done and persist.
        let currentMessages: Anthropic.MessageParam[] = messages;
        let combinedAssistantText = "";
        let finalUsage: Anthropic.Usage | null = null;

        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          const messageStream = client.messages.stream(
            {
              model,
              max_tokens: MAX_TOKENS,
              system: [
                {
                  type: "text",
                  text: systemPromptText,
                  cache_control: { type: "ephemeral" },
                },
              ],
              messages: currentMessages,
              tools: toolDefs,
            },
            { signal: abortSignal }
          );

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
          const textThisTurn = final.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");
          combinedAssistantText += textThisTurn;
          finalUsage = final.usage;

          if (final.stop_reason !== "tool_use") break;

          // Execute every tool_use block from this response and
          // continue the conversation with the tool_result blocks.
          const toolUses = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );
          const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolUses.map(async (tu) => {
              const tool = tools.find((t) => t.definition.name === tu.name);
              let payload: unknown;
              if (!tool) {
                payload = { status: "error", message: `unknown tool: ${tu.name}` };
              } else {
                try {
                  payload = await tool.handler(tu.input);
                } catch {
                  // Tools shouldn't throw for expected states, but if
                  // one does, return a safe error shape rather than
                  // killing the whole stream.
                  payload = { status: "error", message: "tool execution failed" };
                }
              }
              return {
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify(payload),
              };
            })
          );

          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: final.content },
            { role: "user", content: toolResults },
          ];
        }

        const assistantText = combinedAssistantText.trim();
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
            usage: finalUsage,
          })
        );

        // Fire-and-forget title generation after the first exchange.
        // Passes the request signal so a client disconnect between
        // controller.close() and the title call landing kills the
        // Anthropic follow-up too — previously it would run to
        // completion on the server with dangling DB writes.
        if (isFirstExchange) {
          void generateTitleForConversation({
            client,
            model,
            systemPromptText,
            messages,
            assistantText,
            conversationId,
            currentUserId: session.profile.id,
            signal: abortSignal,
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

async function loadSystemPrompt(mode: "about" | "general"): Promise<string> {
  const filePath = path.join(process.cwd(), "prompts", "leadership-coach.md");
  const base = await fs.readFile(filePath, "utf8");
  if (mode === "about") return base;
  return `${GENERAL_MODE_PREAMBLE}\n\n${base}`;
}

// Injected ahead of leadership-coach.md in general (Ask Aimee) mode.
// Shifts persona (Aimee, AiMS Leadership Coach), disables all
// person-data assumptions, and hardens the confabulation rule for the
// no-subject case. Kept inline rather than in a second .md file so
// the base prompt stays a single source of truth.
const GENERAL_MODE_PREAMBLE = `You are Aimee, the AiMS Leadership Coach.

Introduce yourself as Aimee, the AiMS Leadership Coach, when a natural moment arises — do not belabor the name.

There is no subject on file for this conversation. The participant brings the situation in-thread. They may be reflecting on themselves, working through an issue with someone else, weighing a decision, or preparing for a conversation. Follow their lead rather than assuming which of those it is.

You have no data about any specific person the participant mentions — no commitments, no scorecard, no strengths profile, nothing. Do not call any person-data tools. Do not reference commitments, scorecards, or strengths unless the participant has shared that information in this conversation.

If asked what you know about a person, say plainly that you have no information about them and invite the participant to share what they'd like you to know. Never invent a profile, history, or details about a person.

Use whatever company-level context is provided below (purpose, values, focus areas). If a section is sparse or absent, proceed without it and never fabricate company detail.

Otherwise, follow the coaching approach in the base prompt below — help the participant lay out the situation before offering any diagnosis.`;

function buildMessages(
  history: ReadonlyArray<Pick<CoachingMessage, "role" | "content">>,
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
  signal?: AbortSignal;
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
    const response = await args.client.messages.create(
      {
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
      },
      { signal: args.signal }
    );
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
