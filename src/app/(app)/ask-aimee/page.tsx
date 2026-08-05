import Link from "next/link";
import { requireProfile } from "@/lib/auth/current-user";
import { listGeneralConversationsForUser } from "@/lib/coach/service";
import { PageShell } from "@/components/ui/PageShell";
import { AskAimeeNewButton } from "./AskAimeeNewButton";
import { ArchiveConversationButton } from "../coach/[profileId]/ArchiveConversationButton";
import styles from "../coach/coach.module.css";

// Ask Aimee — the general coaching surface. No subject on file; the
// user brings the situation. Available to every active member of a
// company. Conversations are creator-private (RLS scopes SELECT to
// created_by = auth.uid()); no one else, admins included, can see
// them.

export default async function AskAimeePage() {
  const session = await requireProfile();
  const conversations = await listGeneralConversationsForUser(session.profile.id);

  return (
    <PageShell
      eyebrow="Coaching"
      title="Ask Aimee"
      subtitle="A thinking partner for the situation you're working through: a decision, a conversation to prep for, an employee not on the platform, or your own leadership. Your Ask Aimee conversations are visible only to you."
    >
      <div className={styles.card}>
        <div className={styles.listActions}>
          <AskAimeeNewButton />
        </div>
        {conversations.length === 0 ? (
          <p className={styles.emptyLine}>
            No conversations yet. Start one to talk something through.
          </p>
        ) : (
          conversations.map((c) => (
            <div key={c.id} className={styles.conversationRow}>
              <Link
                href={`/ask-aimee/${c.id}`}
                className={styles.conversationLink}
              >
                <span className={styles.conversationTitle}>{c.title}</span>
                {c.lastMessageSnippet ? (
                  <span className={styles.conversationSnippet}>
                    {c.lastMessageSnippet}
                  </span>
                ) : (
                  <span className={styles.conversationSnippet}>
                    (no messages yet)
                  </span>
                )}
                <span className={styles.conversationMeta}>
                  Updated {formatShortDate(c.updated_at)}
                </span>
              </Link>
              <ArchiveConversationButton conversationId={c.id} />
            </div>
          ))
        )}
      </div>
    </PageShell>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
