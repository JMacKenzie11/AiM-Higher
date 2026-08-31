import Link from "next/link";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import {
  listGeneralConversationsForUser,
  listSharedWithMe,
} from "@/lib/coach/service";
import { PageShell } from "@/components/ui/PageShell";
import { PracticeCards } from "@/components/practices/PracticeCards";
import { PRACTICES, findPractice } from "@/lib/practices/registry";
import { practiceRoleGate } from "@/lib/practices/gate";
import { AskAimeeNewButton } from "./AskAimeeNewButton";
import { AskAimeeTabs, type AskAimeeTab } from "./AskAimeeTabs";
import { ArchiveConversationButton } from "../coach/[profileId]/ArchiveConversationButton";
import styles from "../coach/coach.module.css";

// Ask Aimee — the general coaching surface. No subject on file; the
// user brings the situation. Available to every active member of a
// company. Conversations are creator-private (RLS scopes SELECT to
// created_by = auth.uid()); no one else, admins included, can see
// them.
//
// Two tabs: Ask Aimee (default) holds the recent-conversations list
// and the New conversation button. Practice Coaches holds the entry
// cards for each guided practice. Tab state lives in ?tab= so both
// tabs are shareable and no client state is needed.

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function AskAimeePage({ searchParams }: PageProps) {
  const session = await requireProfile();
  const { tab } = await searchParams;
  const activeTab: AskAimeeTab = tab === "coaches" ? "coaches" : "ask";

  // The "current" company for this caller: their own for regular
  // members, the scope cookie for system_admin, cookie-or-single-
  // assignment for aims_guide. Drives both the practice card filter
  // (below) and the conversation list scope (a system_admin who's
  // toggled between two tenants otherwise sees both stacks mixed).
  const companyId = await getEffectiveCompanyId(session);

  // Role-gated practices are hidden from ineligible callers so the
  // landing list doesn't show cards the launcher would reject. The
  // launcher still enforces the gate — this is UX polish, not the
  // security boundary.
  const visiblePractices = PRACTICES.filter((p) => {
    if (!p.allowedRoles) return true;
    if (!companyId) return false;
    return practiceRoleGate(p, session.profile, companyId).ok;
  });

  const [conversations, sharedWithMe] =
    activeTab === "ask"
      ? await Promise.all([
          listGeneralConversationsForUser(session.profile.id, companyId),
          listSharedWithMe(session.profile.id, companyId),
        ])
      : [[], []];

  return (
    <PageShell
      eyebrow="Coaching"
      title="Ask Aimee"
      subtitle="A thinking partner for the situation you're working through: a decision, a conversation to prep for, an employee not on the platform, or your own leadership. Conversations are private to you by default; you can invite specific people from your company as read or write collaborators."
    >
      <AskAimeeTabs active={activeTab} />
      {activeTab === "coaches" ? (
        <PracticeCards practices={visiblePractices} />
      ) : (
        <>
          <div className={styles.card}>
            <div className={styles.listActions}>
              <h2
                style={{
                  margin: 0,
                  marginRight: "auto",
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
                // For practice conversations, the practice title is the
                // real "what is this?" — the c.title is a date stamp
                // (defaultDateLabel) that duplicates the Updated line
                // below. Show the practice title as the heading and
                // drop c.title in that case.
                const heading = practice ? practice.title : c.title;
                return (
                  <div key={c.id} className={styles.conversationRow}>
                    <Link
                      href={`/ask-aimee/${c.id}`}
                      className={styles.conversationLink}
                    >
                      <span className={styles.conversationTitle}>{heading}</span>
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

          {/* Shared-with-you sits as a separate card so the caller
              can visually separate "my threads" from "threads I've
              been invited into". Only rendered when the caller
              actually has any — an empty second card would just be
              noise. Same company scope as the primary list. */}
          {sharedWithMe.length > 0 ? (
            <div className={styles.card} style={{ marginTop: "var(--space-4)" }}>
              <div className={styles.listActions}>
                <h2
                  style={{
                    margin: 0,
                    marginRight: "auto",
                    font: "var(--text-subhead)",
                    textTransform: "uppercase",
                    letterSpacing: "0.15em",
                    color: "var(--text-muted)",
                  }}
                >
                  Shared with you
                </h2>
              </div>
              {sharedWithMe.map((c) => {
                const practice = findPractice(c.practice_id);
                const heading = practice ? practice.title : c.title;
                return (
                  <div key={c.id} className={styles.conversationRow}>
                    <Link
                      href={`/ask-aimee/${c.id}`}
                      className={styles.conversationLink}
                    >
                      <span className={styles.conversationTitle}>{heading}</span>
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
                        From {c.owner_name} · {c.access === "write" ? "Write" : "Read"} ·
                        Updated {formatShortDate(c.updated_at)}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      )}
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
