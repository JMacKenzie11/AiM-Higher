import { NextResponse, type NextRequest } from "next/server";
import { getCurrentSession } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { mayUseCompany } from "@/lib/auth/permissions";
import { chooseAgentForTopic } from "@/lib/aimee/handoff";
import { createPracticeConversation } from "@/lib/practices/create";
import { createGeneralConversation } from "@/lib/coach/create-general";
import { isHandoffToken } from "@/lib/aimee/handoff-path";

// OPENING A "WORK WITH AIMEE" LINK (0281).
//
// An outside assistant handed a short topic over (work_with_aimee) and
// gave the person this link. Everything here runs under the person's
// own session, as if they had started the conversation themselves, so
// the agent's access gate and Aimee's coach memory behave exactly as on
// the Aimee page. The assistant is not involved and sees nothing.
//
//   not signed in        to sign-in, and straight back here
//   not theirs / used /
//   expired / unknown    to a page saying it can't be opened (nothing
//                        about the topic is shown)
//   theirs, fresh        claimed (once), the agent chosen from the same
//                        list Aimee offers from, the conversation started
//                        with the topic, and on to it

export const dynamic = "force-dynamic";

function unavailable(request: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(`/ask-aimee/handoff/unavailable?reason=${reason}`, request.url));
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isHandoffToken(token)) return unavailable(request, "missing");

  const session = await getCurrentSession();
  if (!session?.profile) {
    return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(`/ask-aimee/handoff/${token}`)}`, request.url));
  }

  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await db.rpc("claim_aimee_handoff", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { handoff_id: string | null; company_id: string | null; topic: string | null; state: string }
    | undefined;
  if (error || !row) return unavailable(request, "missing");
  if (row.state !== "ok" || !row.company_id || !row.topic || !row.handoff_id) return unavailable(request, row.state);
  if (!mayUseCompany(session.profile, row.company_id)) return unavailable(request, "not_yours");

  const agent = await chooseAgentForTopic({ db, profile: session.profile, companyId: row.company_id, topic: row.topic });
  const created = agent
    ? await createPracticeConversation(agent, { handoffSummary: row.topic, companyId: row.company_id })
    : await createGeneralConversation({ handoffSummary: row.topic, companyId: row.company_id });
  if (!created.ok) return unavailable(request, "failed");

  await db.rpc("complete_aimee_handoff", { p_id: row.handoff_id, p_agent: agent ?? "", p_conversation: created.item.id });
  // The conversation opens by its id. The company scope cookie is left
  // alone: only the two scope actions may write it (scope-writers.test).
  return NextResponse.redirect(new URL(`/ask-aimee/${created.item.id}`, request.url));
}
