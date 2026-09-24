import Link from "next/link";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { resolveAgent } from "@/lib/practices/resolve";
import { practiceGate } from "@/lib/practices/gate";
import { createPracticeConversation } from "@/lib/practices/create";
import { DEBRIEF_AGENT_ID } from "@/lib/guide/nudges";
import { PageShell } from "@/components/ui/PageShell";

// Opening a nudge: the one place a Guide invitation turns into a
// conversation.
//
// Nothing is generated when the nudge is RAISED — a nudge is a
// notification row and a headline, and that is all. The conversation
// starts here, under the champion's own session, on their own
// client, which is what makes the agent's tools return what THEY can
// see rather than what a background job could.
//
// ---- OPENING TWICE ---------------------------------------------
//
// The notification stays in the bar after it is clicked, so the
// second click is normal, not an edge case. It lands on the
// conversation that already exists. Creating a second one would
// split a debrief across two chats and count one invitation as two
// opens in the measurement.
//
// ---- WHO MAY OPEN IT -------------------------------------------
//
// The recipient, and nobody else. A company_admin can reach the
// debrief AGENT from the picker — it is their meeting too — but a
// nudge is addressed to a person, and opening somebody else's would
// mark THEIR invitation as taken up. RLS says the same thing: the
// update policy in 0235 is recipient-only.

type PageProps = { params: Promise<{ id: string }> };

export default async function GuideNudgePage({ params }: PageProps) {
  const { id } = await params;
  const session = await requireProfile();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: nudge } = await db
    .from("guide_nudges")
    .select(
      "id, company_id, recipient_profile_id, meeting_id, state, conversation_id"
    )
    .eq("id", id)
    .maybeSingle<{
      id: string;
      company_id: string;
      recipient_profile_id: string;
      meeting_id: string | null;
      state: string;
      conversation_id: string | null;
    }>();

  // The select policy lets admins read these, so "found" is not the
  // same question as "yours". Both answers are the same page.
  if (!nudge || nudge.recipient_profile_id !== session.profile.id) {
    return notAvailable("That invitation isn't yours to open.");
  }

  // Already open: go where it went.
  if (nudge.conversation_id) {
    redirect(`/ask-aimee/${nudge.conversation_id}`);
  }

  if (nudge.state === "dismissed") {
    return notAvailable(
      "You waved that one away. Aimee will be in touch after the next meeting."
    );
  }

  const practice = await resolveAgent(DEBRIEF_AGENT_ID);
  if (!practice) return notAvailable("That agent isn't available.");

  const gate = await practiceGate(practice, session.profile, nudge.company_id);
  if (!gate.ok) return notAvailable(gate.message);

  let conversationId: string;
  try {
    const result = await createPracticeConversation(practice.id, {
      debriefingMeetingId: nudge.meeting_id ?? undefined,
    });
    if (!result.ok) return notAvailable(result.message);
    conversationId = result.item.id;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    console.error("[guide] opening nudge failed", err);
    return notAvailable("Couldn't start that chat.");
  }

  // Recorded AFTER the conversation exists, so a failure above
  // leaves the nudge pending and clickable rather than marking it
  // opened with nowhere to go.
  //
  // The write is not checked, on purpose: the champion is about to
  // land in a working conversation, and refusing them that because
  // a measurement row did not update would be the tail wagging the
  // dog. A lost update costs one number.
  const { error } = await db
    .from("guide_nudges")
    .update({
      state: "opened",
      opened_at: new Date().toISOString(),
      conversation_id: conversationId,
    })
    .eq("id", nudge.id);
  if (error) {
    console.error(`[guide] nudge ${nudge.id} opened but not recorded:`, error.message);
  }

  redirect(`/ask-aimee/${conversationId}`);
}

function notAvailable(message: string) {
  return (
    <PageShell
      eyebrow="Aimee"
      title="Couldn't open that"
      subtitle={message}
    >
      <p style={{ marginTop: "var(--space-4)" }}>
        <Link href="/ask-aimee">← Back to Ask Aimee</Link>
      </p>
    </PageShell>
  );
}
