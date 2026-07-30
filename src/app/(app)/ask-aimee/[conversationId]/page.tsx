import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getConversation, getMessages } from "@/lib/coach/service";
import { ChatView } from "../../coach/[profileId]/[conversationId]/ChatView";
import styles from "../../coach/coach.module.css";

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

  return (
    <div className={styles.page}>
      <Link href="/ask-aimee" className={styles.crumb}>
        ← All conversations
      </Link>
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
      />
    </div>
  );
}
