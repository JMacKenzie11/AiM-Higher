import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConversation, getMessages } from "@/lib/coach/service";
import { ChatView } from "./ChatView";
import type { Profile } from "@/lib/types";
import styles from "../../coach.module.css";

type PageProps = {
  params: Promise<{ profileId: string; conversationId: string }>;
};

export default async function CoachChatPage({ params }: PageProps) {
  const session = await requireProfile();

  const { profileId, conversationId } = await params;

  const conversation = await getConversation(conversationId);
  if (!conversation) notFound();
  if (conversation.subject_profile_id !== profileId) notFound();
  // RLS already scopes to created_by; this guard is defense-in-depth.
  if (conversation.created_by !== session.profile.id) redirect("/");

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

  const firstName = subject.full_name.split(" ")[0] ?? subject.full_name;

  return (
    <div className={styles.page}>
      <Link href={`/coach/${profileId}`} className={styles.crumb}>
        ← All conversations
      </Link>
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
        }))}
      />
    </div>
  );
}
