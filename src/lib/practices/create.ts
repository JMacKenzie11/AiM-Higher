import "server-only";

import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CoachingConversation } from "@/lib/coach/service";
import { resolveAgent } from "./resolve";
import { liveVersionIdFor } from "./version-config";
import { practiceGate } from "./gate";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Pure creation logic for a practice conversation. Kept in its own
// module (no "use server" directive) so it's safe to call from both
// server actions AND server-component page renders. Next.js 15 forbids
// revalidatePath during a render — the launch page at /ask-aimee/new
// invokes this function inline and does NOT revalidate (the caller
// redirects to the fresh conversation right after, so there's nothing
// to invalidate on the previous route).
//
// The server-action wrapper in actions.ts calls this same function
// and then does revalidatePath("/ask-aimee") so a click on the
// Practice card refreshes the recent-conversations list.

export type CreateResult =
  | { ok: true; item: CoachingConversation }
  | { ok: false; message: string };

export async function createPracticeConversation(
  practiceId: string,
  // The role description this conversation was opened to revise, if
  // any. Recorded on the row rather than inferred later: the
  // conversation the document came from is private to whoever held
  // it, so a second person revising it is always somewhere new, and
  // nothing about the new conversation would otherwise say which
  // document it is about. Migration 0224.
  // The meeting a debrief was opened about. Same reasoning as
  // revisingRoleId: the conversation is new, it was opened from a
  // notification, and nothing else on the row would say which
  // meeting it came from. Migration 0235.
  //
  // `opener`: a scripted first turn supplied by whatever launched the
  // conversation, rather than by the agent. See OPENING TURN below.
  //
  // `handoffSummary` and `offeredInMessageId`: a session started from
  // Aimee's offer in an open conversation (0262, 0263). The summary
  // rides on every turn (lib/aimee/session-offers.ts); the message id
  // makes a second click open this conversation rather than another
  // (lib/aimee/session-offer-actions.ts).
  options?: {
    revisingRoleId?: string;
    debriefingMeetingId?: string;
    opener?: string;
    handoffSummary?: string;
    offeredInMessageId?: string;
  }
): Promise<CreateResult> {
  const practice = await resolveAgent(practiceId);
  if (!practice) {
    return { ok: false, message: "That practice isn't available." };
  }

  const session = await requireProfile();

  // Route resolution through the canonical helper so system_admin
  // and aims_guide callers both work (guide-only fallback lives
  // inside getEffectiveCompanyId).
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) {
    return {
      ok: false,
      message:
        "Scope into a company first — practices run against a company's context.",
    };
  }

  const gate = await practiceGate(practice, session.profile, companyId);
  if (!gate.ok) return gate;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const title = defaultDateLabel();
  const { data, error } = await supabase
    .from("coaching_conversations")
    .insert({
      company_id: companyId,
      subject_profile_id: null,
      created_by: session.profile.id,
      title,
      context_kind: "execution",
      mode: "general",
      practice_id: practice.id,
      // THE PIN. Stamped once, here, from the agent's live pointer.
      // Null when the agent has no published version, which means
      // "runs from the code registry" and is true of every agent
      // until somebody presses Publish.
      //
      // Read at creation rather than at each turn on purpose: a
      // publish that lands mid-conversation must not change what
      // this conversation says.
      agent_version_id: await liveVersionIdFor(practice.agentRowId),
      revising_role_id: options?.revisingRoleId ?? null,
      debriefing_meeting_id: options?.debriefingMeetingId ?? null,
      // Only when set, so an instance 0262/0263 has not reached can
      // still start every other kind of session.
      ...(options?.handoffSummary ? { handoff_summary: options.handoffSummary } : {}),
      ...(options?.offeredInMessageId ? { offered_in_message_id: options.offeredInMessageId } : {}),
    })
    .select("*")
    .single<CoachingConversation>();
  if (error || !data) {
    console.error("createPracticeConversation insert failed", error);
    return { ok: false, message: "Couldn't start that practice." };
  }

  // ---- OPENING TURN ------------------------------------------
  //
  // Scripted openers are persisted here, up-front, as the first
  // assistant message with no model call. Two sources, in order:
  //
  //   1. The launch. Whatever opened the conversation already said
  //      something to this person, and that is the conversation's
  //      first turn. A Guide invitation is the case: its line was
  //      written and checked when it was raised (guide/headline.ts),
  //      the champion read it in the notification bar, and clicking it
  //      is answering it. Generating a second opener made the agent
  //      repeat the line, drift to another part of the meeting, or
  //      break voice rules the line had already been held to.
  //
  //   2. The agent. firstTurn "scripted" (or omitted, for backward
  //      compat) with a scriptedOpener.
  //
  // With neither, a firstTurn "generate" agent gets its opener
  // streamed by ChatView right after landing on the chat page (a
  // client-side effect fires /api/coach with generateOpener: true).
  // ChatView only does that for an EMPTY conversation, so a persisted
  // opener here is also what stops a generated one.
  //
  // If the insert fails the conversation is empty, and a "generate"
  // agent falls back to writing its own opener, with the opener checks
  // in /api/coach. Logged below; the person still lands in a working
  // conversation.
  const launchOpener = options?.opener?.trim() || null;
  const agentOpener =
    practice.scriptedOpener &&
    (practice.firstTurn === "scripted" || practice.firstTurn === undefined)
      ? practice.scriptedOpener
      : null;
  const opener = launchOpener ?? agentOpener;
  if (opener) {
    try {
      const { error: openerErr } = await supabase
        .from("coaching_messages")
        .insert({
          conversation_id: data.id,
          created_by: session.profile.id,
          role: "assistant",
          content: opener,
        });
      if (openerErr) {
        console.error(
          "createPracticeConversation opener insert failed",
          openerErr
        );
      }
    } catch (err) {
      console.error("createPracticeConversation opener insert threw", err);
    }
  }

  return { ok: true, item: data };
}

function defaultDateLabel(): string {
  const now = new Date();
  return now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
