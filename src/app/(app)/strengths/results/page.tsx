import Link from "next/link";
import { redirect } from "next/navigation";
import ResultsView from "@/components/strengths/ResultsView";
import CoachingSummaryCard from "@/components/strengths/CoachingSummaryCard";
import GenerateResultsIfMissing from "./GenerateResultsIfMissing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ResultsProfile } from "@/lib/strengths/types";
import styles from "../strengths.module.css";

export default async function ResultsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name")
    .eq("id", user.id)
    .single();

  const { data: assessment } = await supabase
    .from("strengths_assessments")
    .select("id, status")
    .eq("user_id", user.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  // No assessment at all — render an empty state instead of silently
  // bouncing to /welcome. Coming from a menu labelled "Results", the
  // silent redirect looks like a bug.
  if (!assessment) {
    return (
      <ResultsEmptyState
        firstName={profile?.first_name ?? ""}
        title="No results yet"
        body="You haven't taken the strengths assessment. It's a ten-to-twelve minute read of where your energy sits — start it and your results will land here."
        ctaHref="/strengths/welcome"
        ctaLabel="Start the assessment"
      />
    );
  }
  // In-progress — same idea. Show the "pick it back up" empty state
  // rather than redirecting so the URL matches the menu click.
  if (assessment.status !== "completed") {
    return (
      <ResultsEmptyState
        firstName={profile?.first_name ?? ""}
        title="Results aren't ready yet"
        body="Your assessment is in progress. Finish it and your results will show up here."
        ctaHref="/strengths/assessment"
        ctaLabel="Continue the assessment"
      />
    );
  }

  const { data: results } = await supabase
    .from("strengths_results")
    .select("profile, summary")
    .eq("assessment_id", assessment.id)
    .maybeSingle();

  // Summarize the coaching thread for the dashboard banner. RLS restricts
  // coaching_conversations / coaching_messages to the owner, so admins can
  // never see this data even if they viewed a team member's results (which
  // uses ResultsView too — but /results is only ever the team member's own).
  const { data: conversation } = await supabase
    .from("coaching_conversations")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let exchangeCount = 0;
  let lastActivity: string | null = null;
  let lastAssistantMessage: string | null = null;
  if (conversation?.id) {
    const { data: msgs } = await supabase
      .from("coaching_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true });
    const list = msgs ?? [];
    exchangeCount = list.filter((m) => m.role === "user").length;
    const lastMsg = list.at(-1);
    lastActivity = (lastMsg?.created_at as string | null) ?? null;
    const lastAssistant = [...list]
      .reverse()
      .find((m) => m.role === "assistant");
    lastAssistantMessage =
      (lastAssistant?.content as string | null) ?? null;
  }

  if (!results) {
    return <GenerateResultsIfMissing assessmentId={assessment.id} />;
  }

  return (
    <ResultsView
      firstName={profile?.first_name ?? ""}
      results={{
        profile: results.profile as ResultsProfile,
        summary: results.summary,
      }}
      showCoachingLink={false}
      banner={
        <CoachingSummaryCard
          firstName={profile?.first_name ?? ""}
          summary={{
            hasConversation: !!conversation,
            exchangeCount,
            lastActivity,
            lastAssistantMessage,
          }}
        />
      }
    />
  );
}

function ResultsEmptyState({
  firstName,
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  firstName: string;
  title: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Strengths results">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Strengths results</p>
          <h1 className={styles.h1}>
            {firstName ? `Your strengths, ${firstName}` : "Your strengths"}
          </h1>
          <span className={styles.rule} aria-hidden="true" />
        </div>
      </section>
      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="results-empty">
          <h2 id="results-empty" className={styles.h2}>
            {title}
          </h2>
          <p className={styles.prose}>{body}</p>
          <Link href={ctaHref} className={styles.primaryButton}>
            {ctaLabel}
          </Link>
        </section>
      </div>
    </div>
  );
}
