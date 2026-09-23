import "server-only";

import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { trackAfter } from "@/lib/analytics/track";
import { defaultTitleForToday } from "./title";
import type { CoachingConversation } from "./service";

// Starting a plain Ask Aimee conversation.
//
// ---- WHY THIS IS NOT THE SERVER ACTION ------------------------
//
// /ask-aimee/new with no query parameters is a server component
// that creates a conversation and redirects into it. It called
// createGeneralConversationAction() during render, and that action
// ends with revalidatePath("/ask-aimee").
//
// Revalidating during render is forbidden: it asks the framework to
// invalidate a cache while it is in the middle of building the page.
// Next throws, and the route 500s. Only the no-parameter branch was
// affected — /ask-aimee/new?agent=X goes through
// createPracticeConversation, which is "server-only" and revalidates
// nothing, which is exactly the shape this file now copies.
//
// So the work lives here, with no cache calls in it, and the action
// is a thin wrapper that adds the revalidation a form submission
// needs. A page renders it; a button calls the action.
//
// Analytics stays HERE rather than in the wrapper, because a
// conversation opened from the URL is a conversation opened.

export type CreateGeneralResult =
  | { ok: true; item: CoachingConversation }
  | { ok: false; message: string };

export async function createGeneralConversation(): Promise<CreateGeneralResult> {
  const session = await requireProfile();

  // Single-source-of-truth resolver: regular members return their
  // own company_id, system_admins their scope cookie, aims_guides
  // cookie-or-single-assignment.
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) {
    return {
      ok: false,
      message:
        "Scope into a company first — coaching runs against a company's context.",
    };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("coaching_conversations")
    .insert({
      company_id: companyId,
      subject_profile_id: null,
      created_by: session.profile.id,
      title: defaultTitleForToday(),
      context_kind: "execution",
      mode: "general",
    })
    .select("*")
    .single<CoachingConversation>();
  if (error || !data) {
    console.error("createGeneralConversation insert failed", error);
    const detail = error?.message ? ` (${error.message})` : "";
    return { ok: false, message: `Couldn't start that conversation.${detail}` };
  }

  trackAfter(
    session.profile.id,
    "coach.thread_opened",
    { mode: "general", context_kind: "execution" },
    { company: companyId }
  );
  return { ok: true, item: data };
}
