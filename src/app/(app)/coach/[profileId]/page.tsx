import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listConversationsForSubject } from "@/lib/coach/service";
import { NewConversationButton } from "./NewConversationButton";
import { ArchiveConversationButton } from "./ArchiveConversationButton";
import type { Profile } from "@/lib/types";
import styles from "../coach.module.css";

type PageProps = { params: Promise<{ profileId: string }> };

export default async function CoachListPage({ params }: PageProps) {
  const session = await requireProfile();
  const role = session.profile.role;
  if (role !== "system_admin" && role !== "company_admin") {
    redirect("/");
  }

  const { profileId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: subject } = await supabase
    .from("profiles")
    .select("id, full_name, position, company_id")
    .eq("id", profileId)
    .maybeSingle<
      Pick<Profile, "id" | "full_name" | "position" | "company_id">
    >();
  if (!subject) notFound();
  if (
    role === "company_admin" &&
    subject.company_id !== session.profile.company_id
  ) {
    redirect("/");
  }

  const conversations = await listConversationsForSubject(profileId);

  return (
    <div className={styles.page}>
      <Link href={`/people/${profileId}`} className={styles.crumb}>
        ← Back to {subject.full_name}
      </Link>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Coaching</p>
        <h1 className={styles.h1}>Coaching · {subject.full_name}</h1>
        <span className="aims-rule" aria-hidden="true" />
        {subject.position ? (
          <p className={styles.conversationMeta}>{subject.position}</p>
        ) : null}
      </header>

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
