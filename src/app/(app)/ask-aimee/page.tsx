import Link from "next/link";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import {
  listConversationsForUser,
  listSharedWithMe,
} from "@/lib/coach/service";
import { PageShell } from "@/components/ui/PageShell";
import { listAgentsIncludingArchived } from "@/lib/practices/resolve";
import { AskAimeeNewButton } from "./AskAimeeNewButton";
import { MemorySweep } from "./MemorySweep";
import { ArchiveConversationButton } from "../coach/[profileId]/ArchiveConversationButton";
import styles from "../coach/coach.module.css";

// Ask Aimee — the general coaching surface. No subject on file; the
// user brings the situation. Available to every active member of a
// company. Conversations are creator-private (RLS scopes SELECT to
// created_by = auth.uid()); a share overlay lets the owner grant
// same-company read or collaborate access per thread.
//
// The former Practice Coaches tab is retired — agents now attach
// to a chat via the AgentPicker in the composer, so the landing
// page is a single unified view: recent conversations + shared
// with you (when non-empty).

export default async function AskAimeePage() {
  const session = await requireProfile();

  // The "current" company for this caller: their own for regular
  // members, the scope cookie for system_admin, cookie-or-single-
  // assignment for aims_guide. Scopes the recent + shared lists
  // so a system_admin who's toggled between two tenants doesn't
  // see mixed stacks.
  const companyId = await getEffectiveCompanyId(session);

  const [conversations, sharedWithMe, allAgents] = await Promise.all([
    listConversationsForUser(session.profile.id, companyId),
    listSharedWithMe(session.profile.id, companyId),
    // Archived included: a conversation attached to an agent that
    // has since been archived still shows that agent's name, because
    // archiving hides an agent from pickers and does not rewrite
    // history.
    listAgentsIncludingArchived(),
  ]);
  // One lookup rather than an await per row: both lists map over
  // conversations and each row wants its agent's title.
  const agentsById = new Map(allAgents.map((a) => [a.id, a]));

  return (
    <PageShell
      eyebrow="Coaching"
      title="Ask Aimee"
      subtitle="A thinking partner for the situation you're working through: a decision, a conversation to prep for, an employee not on the platform, or your own leadership. Conversations are private to you by default; you can invite specific people from your company as collaborators, and pick a guided agent from inside any chat."
    >
      {/* Entering the surface with nothing open: every finished
          conversation is a candidate. */}
      <MemorySweep openConversationId={null} />
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
            const practice = c.practice_id
              ? agentsById.get(c.practice_id) ?? null
              : null;
            // For agent-attached conversations, the agent title is the
            // real "what is this?" — the c.title is a date stamp
            // (defaultDateLabel) that duplicates the Updated line
            // below. Show the agent title as the heading and drop
            // c.title in that case.
            const heading = practice ? practice.title : c.title;
            // A conversation ABOUT somebody lives on their coach
            // page: that is where the subject's memory and history
            // are. /ask-aimee/<id> would redirect there anyway, so
            // this links straight through rather than bouncing.
            const about = c.mode === "about" && c.subject_profile_id;
            const href = about
              ? `/coach/${c.subject_profile_id}/${c.id}`
              : `/ask-aimee/${c.id}`;
            return (
              <div key={c.id} className={styles.conversationRow}>
                <Link href={href} className={styles.conversationLink}>
                  <span className={styles.conversationTitle}>
                    {heading}
                    {about ? (
                      // The name, because "Coaching · Sep 23" beside
                      // three other rows that also say Coaching is
                      // not a title anybody can pick from.
                      <span className={styles.conversationAbout}>
                        {c.subjectName
                          ? ` · about ${c.subjectName}`
                          : " · about a team member"}
                      </span>
                    ) : null}
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
            const practice = c.practice_id
              ? agentsById.get(c.practice_id) ?? null
              : null;
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
                    From {c.owner_name} · {c.access === "write" ? "Collaborate" : "Read-only"} ·
                    Updated {formatShortDate(c.updated_at)}
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
      ) : null}
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
