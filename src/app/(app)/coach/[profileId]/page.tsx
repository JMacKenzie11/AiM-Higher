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

  // Access: system admins reach anyone; company admins reach anyone
  // in their own company; team members reach only themselves.
  const isSelf = subject.id === session.profile.id;
  const isSystemAdmin = role === "system_admin";
  const isCompanyAdmin =
    role === "company_admin" &&
    subject.company_id === session.profile.company_id;
  if (!isSelf && !isSystemAdmin && !isCompanyAdmin) {
    redirect("/");
  }

  const conversations = await listConversationsForSubject(profileId);

  const firstName = subject.full_name.split(" ")[0] ?? subject.full_name;
  const backHref = isSelf ? "/profile" : `/people/${profileId}`;
  const backLabel = isSelf
    ? "Back to my profile"
    : `Back to ${firstName}'s scorecard`;

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
