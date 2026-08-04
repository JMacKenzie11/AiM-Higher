import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listConversationsForSubject } from "@/lib/coach/service";
import { NewConversationButton } from "./NewConversationButton";
import { ArchiveConversationButton } from "./ArchiveConversationButton";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import type { Profile } from "@/lib/types";
import styles from "../coach.module.css";

type PageProps = {
  params: Promise<{ profileId: string }>;
};

export default async function CoachListPage({ params }: PageProps) {
  const session = await requireProfile();
  const role = session.profile.role;

  const { profileId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: subject } = await supabase
    .from("profiles")
    .select("id, full_name, position, company_id, reports_to")
    .eq("id", profileId)
    .maybeSingle<
      Pick<Profile, "id" | "full_name" | "position" | "company_id" | "reports_to">
    >();
  if (!subject) notFound();

  // Self-coaching is retired — anyone landing on their own coach URL
  // (bookmark, deep link) gets redirected to Ask Aimee.
  if (subject.id === session.profile.id) redirect("/ask-aimee");

  // Access mirrors the RLS insert policy for mode='about': system
  // admin anywhere, company admin within the subject's company, or
  // the subject's direct manager.
  const isSystemAdmin = role === "system_admin";
  const isCompanyAdmin =
    role === "company_admin" &&
    subject.company_id === session.profile.company_id;
  const isManager = subject.reports_to === session.profile.id;
  if (!isSystemAdmin && !isCompanyAdmin && !isManager) {
    redirect("/");
  }

  const conversations = await listConversationsForSubject(profileId);

  const firstName = subject.full_name.split(" ")[0] ?? subject.full_name;
  const backHref = `/people/${profileId}`;
  const backLabel = `Back to ${firstName}'s scorecard`;

  return (
    <div className={styles.page}>
      <Link href={backHref} className={styles.crumb}>
        ← {backLabel}
      </Link>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Coaching</p>
        <h1 className={styles.h1}>Coaching · {subject.full_name}</h1>
        <span className="aims-rule" aria-hidden="true" />
        {subject.position ? (
          <p className={styles.conversationMeta}>{subject.position}</p>
        ) : null}
      </header>

      <div style={{ marginTop: "var(--space-3)" }}>
        <PrivacyNote tone="private">
          Only you can see the coaching threads you create about{" "}
          {firstName}. Other admins and {firstName}&rsquo;s direct manager
          can create their own separate threads — those stay private to
          their creator too. {firstName} cannot see any of them.
        </PrivacyNote>
      </div>

      <div className={styles.listActions}>
        <NewConversationButton profileId={profileId} />
      </div>

      <div className={styles.card}>
        {conversations.length === 0 ? (
          <p className={styles.emptyLine}>
            No conversations yet. Start one to talk through what&rsquo;s on your
            mind about {subject.full_name.split(" ")[0]}.
          </p>
        ) : (
          conversations.map((c) => (
            <div key={c.id} className={styles.conversationRow}>
              <Link
                href={`/coach/${profileId}/${c.id}`}
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
    </div>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
