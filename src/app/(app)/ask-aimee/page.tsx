import Link from "next/link";
import { requireProfile } from "@/lib/auth/current-user";
import { listGeneralConversationsForUser } from "@/lib/coach/service";
import { PageShell } from "@/components/ui/PageShell";
import { PracticeCards } from "@/components/practices/PracticeCards";
import { PRACTICES, findPractice } from "@/lib/practices/registry";
import { AskAimeeNewButton } from "./AskAimeeNewButton";
import { ArchiveConversationButton } from "../coach/[profileId]/ArchiveConversationButton";
import styles from "../coach/coach.module.css";

// Ask Aimee — the general coaching surface. No subject on file; the
// user brings the situation. Available to every active member of a
// company. Conversations are creator-private (RLS scopes SELECT to
// created_by = auth.uid()); no one else, admins included, can see
// them.
//
// Practices sit at the top of the page as the deliberate entry
// points ("I have a real thing to work through"); the free-form
// conversation list ("resume something I started") lives underneath.
// As the conversation history grows, practices stay in a fixed
// place at the top instead of getting buried at the bottom.

export default async function AskAimeePage() {
  const session = await requireProfile();
  const conversations = await listGeneralConversationsForUser(session.profile.id);

  return (
    <PageShell
      eyebrow="Coaching"
      title="Ask Aimee"
      subtitle="A thinking partner for the situation you're working through: a decision, a conversation to prep for, an employee not on the platform, or your own leadership. Your Ask Aimee conversations are visible only to you."
    >
      <PracticeCards practices={PRACTICES} />

      <div className={styles.card} style={{ marginTop: "var(--space-6)" }}>
        <div className={styles.listActions}>
          <h2
            style={{
              margin: 0,
              font: "var(--text-subhead)",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: "var(--text-muted)",
            }}
          >
            Recent conversations
          </h2>
          <AskAimeeNewButton />
        </div>
        {conversations.length === 0 ? (
          <p className={styles.emptyLine}>
            No conversations yet. Start one to talk something through.
          </p>
        ) : (
          conversations.map((c) => {
            const practice = findPractice(c.practice_id);
            return (
              <div key={c.id} className={styles.conversationRow}>
                <Link
                  href={`/ask-aimee/${c.id}`}
                  className={styles.conversationLink}
                >
                  <span className={styles.conversationTitle}>
                    {practice ? (
                      <span
                        style={{
                          color: "var(--text-muted)",
                          fontWeight: 500,
                          marginRight: 6,
                        }}
                      >
                        {practice.title} ·
                      </span>
                    ) : null}
                    {c.title}
                  </span>
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
            );
          })
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
