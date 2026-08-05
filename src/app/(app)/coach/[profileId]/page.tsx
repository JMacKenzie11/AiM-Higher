import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listConversationsForSubject } from "@/lib/coach/service";
import { NewConversationButton } from "./NewConversationButton";
import { ArchiveConversationButton } from "./ArchiveConversationButton";
import { PageShell } from "@/components/ui/PageShell";
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

  return (
    <PageShell
      backHref={`/people/${profileId}`}
      backLabel={`Back to ${firstName}'s scorecard`}
      eyebrow="Coaching"
      title={subject.full_name}
      subtitle={subject.position ?? undefined}
    >
      <PrivacyNote tone="private">
        Only you can see the coaching threads you create about {firstName}.
        Other admins and {firstName}&rsquo;s direct manager can create their
        own separate threads — those stay private to their creator too.{" "}
        {firstName} cannot see any of them.
      </PrivacyNote>

      <div className={styles.card}>
        <div className={styles.listActions}>
          <NewConversationButton profileId={profileId} />
        </div>
        {conversations.length === 0 ? (
          <p className={styles.emptyLine}>
            No conversations yet. Start one to talk through what&rsquo;s on
            your mind about {firstName}.
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
