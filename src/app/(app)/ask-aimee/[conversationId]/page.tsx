import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import {
  getAccessForConversation,
  getConversation,
  getMessages,
  getMessageSenders,
  listSharesForConversation,
} from "@/lib/coach/service";
import { findPractice } from "@/lib/practices/registry";
import { PageShell } from "@/components/ui/PageShell";
import { ChatView } from "../../coach/[profileId]/[conversationId]/ChatView";
import { ShareChatButton } from "./ShareChatButton";

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
  // Access check: owner (created_by = me) or someone with a share
  // row. RLS already blocks the SELECT for anyone else, but explicit
  // check gives us the right UI branch (owner vs. write vs. read)
  // and a friendly 404 instead of a silent empty state.
  const access = await getAccessForConversation(
    conversation.id,
    session.profile.id
  );
  if (access === null) notFound();

  const messages = await getMessages(conversationId);

  // Build the sender lookup once, server-side, from the union of
  // (message authors, share list, owner). The client uses it to
  // render attribution on user bubbles when the thread has any
  // shares. Owner is included so their own past messages have a
  // display record even before shares appear — cheap and keeps the
  // client logic simple.
  const shares = await listSharesForConversation(conversationId);
  const senderIds = new Set<string>();
  senderIds.add(conversation.created_by);
  for (const s of shares) senderIds.add(s.profile_id);
  for (const m of messages) senderIds.add(m.created_by);
  const senderInfo = await getMessageSenders(Array.from(senderIds));
  const senders: Record<string, { full_name: string; avatar_url: string | null }> = {};
  for (const [id, info] of senderInfo) senders[id] = info;

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
          created_by: m.created_by,
        }))}
        practice={practice}
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
