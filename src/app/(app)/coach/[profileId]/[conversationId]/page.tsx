import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getAccessForConversation,
  getConversation,
  getMessages,
  getMessageSenders,
  listSharesForConversation,
} from "@/lib/coach/service";
import { PageShell } from "@/components/ui/PageShell";
import { ChatView } from "./ChatView";
import { ShareChatButton } from "../../../ask-aimee/[conversationId]/ShareChatButton";
import type { Profile } from "@/lib/types";

type PageProps = {
  params: Promise<{ profileId: string; conversationId: string }>;
};

export default async function CoachChatPage({ params }: PageProps) {
  const session = await requireProfile();

  const { profileId, conversationId } = await params;

  const conversation = await getConversation(conversationId);
  if (!conversation) notFound();
  // General (Ask Aimee) conversations live under /ask-aimee. If the
  // creator hits this route via a stale bookmark, send them there.
  if (conversation.mode === "general") {
    if (conversation.created_by === session.profile.id) {
      redirect(`/ask-aimee/${conversation.id}`);
    }
    notFound();
  }
  if (conversation.subject_profile_id !== profileId) notFound();
  // Access check admits owner OR sharee. RLS also scopes SELECT, so
  // a non-participant would already have hit notFound() above via
  // getConversation returning null — this branch decides which UI
  // state to render (write vs. read).
  const access = await getAccessForConversation(
    conversation.id,
    session.profile.id
  );
  if (access === null) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: subject } = await supabase
    .from("profiles")
    .select("id, full_name, position, company_id")
    .eq("id", profileId)
    .maybeSingle<
      Pick<Profile, "id" | "full_name" | "position" | "company_id">
    >();
  if (!subject) notFound();

  const messages = await getMessages(conversationId);

  const shares = await listSharesForConversation(conversationId);
  const senderIds = new Set<string>();
  senderIds.add(conversation.created_by);
  for (const s of shares) senderIds.add(s.profile_id);
  for (const m of messages) senderIds.add(m.created_by);
  const senderInfo = await getMessageSenders(Array.from(senderIds));
  const senders: Record<string, { full_name: string; avatar_url: string | null }> = {};
  for (const [id, info] of senderInfo) senders[id] = info;

  const firstName = subject.full_name.split(" ")[0] ?? subject.full_name;

  return (
    <PageShell
      backHref={`/coach/${profileId}`}
      backLabel="All conversations"
      eyebrow="Coaching"
      title={subject.full_name}
      subtitle={subject.position ?? undefined}
    >
      <ChatView
        conversation={conversation}
        subjectName={subject.full_name}
        subjectPosition={subject.position ?? null}
        firstName={firstName}
        initialMessages={messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at,
          created_by: m.created_by,
        }))}
        access={access}
        currentUserId={session.profile.id}
        senders={senders}
        shareHeader={
          <ShareChatButton
            conversationId={conversation.id}
            access={access}
            shares={shares}
          />
        }
      />
    </PageShell>
  );
}
