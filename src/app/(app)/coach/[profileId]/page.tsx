import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { canCoachAbout } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listConversationsForSubject } from "@/lib/coach/service";
import { NewConversationButton } from "./NewConversationButton";
import { ArchiveConversationButton } from "./ArchiveConversationButton";
import { PageShell } from "@/components/ui/PageShell";
import { MemorySweep } from "../../ask-aimee/MemorySweep";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import type { Profile } from "@/lib/types";
import styles from "../coach.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

type PageProps = {
  params: Promise<{ profileId: string }>;
};

export default async function CoachListPage({ params }: PageProps) {
  const session = await requireProfile();

  const { profileId } = await params;
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: subject } = await supabase
    .from("profiles")
    .select("id, full_name, position, company_id")
    .eq("id", profileId)
    .maybeSingle<Pick<Profile, "id" | "full_name" | "position" | "company_id">>();
  if (!subject) notFound();

  // Self-coaching is retired — anyone landing on their own coach URL
  // (bookmark, deep link) gets redirected to Ask Aimee.
  if (subject.id === session.profile.id) redirect("/ask-aimee");

  // The same rule as the about branch of coaching_conversations_insert
  // (0261): anyone in the person's company, or an admin for it.
  if (!canCoachAbout(session.profile, subject)) {
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
      {/* The sweep fires here too, as of 2026-09-15.
          It used to mount only under /ask-aimee, which was right
          while about-mode conversations produced no memory. Once they
          did, a leader who works entirely in /coach got nothing
          written, ever: the trigger did not fire on the surface the
          feature now serves. Silently, because every failure mode of
          this feature renders as an empty memory page. */}
      <MemorySweep openConversationId={null} />

      <PrivacyNote tone="private">
        Only the person who started a conversation can see it. AiMS reviews
        anonymised summaries of conversation themes to improve Aimee. Anyone
        else in the company can start their own conversations about{" "}
        {firstName}, private to them in the same way, and {firstName} cannot
        see any of them.
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
