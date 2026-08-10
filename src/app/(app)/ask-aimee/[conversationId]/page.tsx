import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getConversation, getMessages } from "@/lib/coach/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findPractice } from "@/lib/practices/registry";
import { PageShell } from "@/components/ui/PageShell";
import type { RosterOption } from "@/components/practices/PracticeSetup";
import type { Profile } from "@/lib/types";
import { ChatView } from "../../coach/[profileId]/[conversationId]/ChatView";

type PageProps = {
  params: Promise<{ conversationId: string }>;
};

export default async function AskAimeeChatPage({ params }: PageProps) {
  const session = await requireProfile();
  const { conversationId } = await params;

  const conversation = await getConversation(conversationId);
  if (!conversation) notFound();
  if (conversation.mode !== "general") {
    // Wrong entry point for a person-scoped conversation. Send the
    // creator to the right place; anyone else can't SELECT it anyway
    // (RLS scopes to created_by), so they'd get notFound.
    if (conversation.subject_profile_id) {
      redirect(`/coach/${conversation.subject_profile_id}/${conversation.id}`);
    }
    notFound();
  }
  if (conversation.created_by !== session.profile.id) redirect("/");

  const messages = await getMessages(conversationId);

  // Practice conversations get the practice's setup UI on the empty
  // state, plus a partner picker scoped to the caller's company
  // roster (excluding themselves). Only fetch the roster when it
  // will actually be shown — a normal Ask Aimee thread doesn't need
  // it.
  const practice = findPractice(conversation.practice_id);
  let practiceRoster: RosterOption[] = [];
  if (practice) {
    const supabase = await createSupabaseServerClient();
    const { data: rows } = await supabase
      .from("profiles")
      .select("id, full_name, position, status")
      .eq("company_id", conversation.company_id)
      .order("full_name");
    practiceRoster = ((rows ?? []) as Array<
      Pick<Profile, "id" | "full_name" | "position" | "status">
    >)
      .filter(
        (p) =>
          p.id !== session.profile.id &&
          (!p.status || p.status === "active")
      )
      .map((p) => ({
        id: p.id,
        full_name: p.full_name,
        position: p.position ?? null,
      }));
  }

  return (
    <PageShell
      backHref="/ask-aimee"
      backLabel="All conversations"
      eyebrow="Coaching"
      title={practice ? practice.title : "Ask Aimee"}
    >
      <ChatView
        conversation={conversation}
        subjectName={null}
        subjectPosition={null}
        firstName={null}
        initialMessages={messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        }))}
        practice={practice}
        practiceRoster={practiceRoster}
      />
    </PageShell>
  );
}
