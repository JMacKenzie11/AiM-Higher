import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getConversation, getMessages } from "@/lib/coach/service";
import { findPractice } from "@/lib/practices/registry";
import { PageShell } from "@/components/ui/PageShell";
import { ChatView } from "../../coach/[profileId]/[conversationId]/ChatView";

type PageProps = {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ from?: string }>;
};

const SAFE_FROM_PREFIXES = ["/classroom", "/chart", "/dashboard"];

function backLinkForFrom(from: string | undefined): {
  href: string;
  label: string;
} {
  const trimmed = from?.trim();
  if (
    trimmed &&
    trimmed.startsWith("/") &&
    SAFE_FROM_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  ) {
    if (trimmed.startsWith("/classroom")) {
      return { href: trimmed, label: "Back to Classroom" };
    }
    if (trimmed.startsWith("/chart")) {
      return { href: trimmed, label: "Back to Functional Chart" };
    }
    if (trimmed.startsWith("/dashboard")) {
      return { href: trimmed, label: "Back to Dashboard" };
    }
  }
  return { href: "/ask-aimee", label: "All conversations" };
}

export default async function AskAimeeChatPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireProfile();
  const { conversationId } = await params;
  const { from } = await searchParams;

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

  // Practice conversations swap the default empty-state chip row for
  // the practice's own header + opening chips. Backend for optional
  // partner context is still in place (columns + action + partner
  // context builder) but no longer surfaced in the UI.
  const practice = findPractice(conversation.practice_id);

  const back = backLinkForFrom(from);
  return (
    <PageShell
      backHref={back.href}
      backLabel={back.label}
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
      />
    </PageShell>
  );
}
