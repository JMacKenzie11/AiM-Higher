import Link from "next/link";
import { redirect } from "next/navigation";
import ResultsView from "@/components/strengths/ResultsView";
import GenerateResultsIfMissing from "./GenerateResultsIfMissing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ResultsProfile } from "@/lib/strengths/types";
import styles from "../strengths.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

export const metadata = { title: "My results" };

export default async function ResultsPage() {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
