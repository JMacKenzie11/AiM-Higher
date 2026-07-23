import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";
import ResultsView from "@/components/strengths/ResultsView";
import type { Profile } from "@/lib/types";
import type { ResultsProfile } from "@/lib/strengths/types";
import styles from "@/app/(app)/strengths/strengths.module.css";

// Admin view of another team member's strengths results (or a team
// member viewing their own, since the same URL pattern works). RLS
// already gates strengths_assessments / strengths_results to
// (owner OR admin-of-same-company), so the page trusts the query
// and just handles the empty states.

type PageProps = { params: Promise<{ id: string }> };

export default async function PersonStrengthsPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  const { data: subject } = await supabase
    .from("profiles")
    .select("id, first_name, full_name, position, company_id")
    .eq("id", id)
    .maybeSingle<
      Pick<Profile, "id" | "first_name" | "full_name" | "position" | "company_id">
    >();
  if (!subject) notFound();

  // Authorization: self OR admin of the same company (system_admin
  // can reach anyone). RLS enforces the strengths reads independently
  // — this gate is what returns a nice not-found instead of a bare
  // empty results screen for people who aren't supposed to see it.
  const isSelf = session.profile.id === subject.id;
  const isSystemAdmin = session.profile.role === "system_admin";
  const isCompanyAdmin =
    session.profile.role === "company_admin" &&
    session.profile.company_id === subject.company_id;
  if (!isSelf && !isSystemAdmin && !isCompanyAdmin) redirect("/people");

  // Feature-gate: if the subject's company doesn't have Strengths,
  // there's nothing to show. Send admins back to People rather than
  // stranding them on a blank page.
  const hasStrengths = subject.company_id
    ? await companyHasFeature(subject.company_id, "strengths")
    : false;
  if (!hasStrengths) redirect(`/people/${subject.id}`);

  const { data: assessment } = await supabase
    .from("strengths_assessments")
    .select("id, status, completed_at")
    .eq("user_id", subject.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string; completed_at: string | null }>();

  if (!assessment) {
    return (
      <PersonStrengthsShell subject={subject} isSelf={isSelf}>
        <p className={styles.prose}>
          {isSelf
            ? "You haven't taken the strengths assessment yet. It takes about ten to twelve minutes."
            : `${subject.first_name} hasn't taken the strengths assessment yet.`}
        </p>
        {isSelf ? (
          <Link href="/strengths/welcome" className={styles.primaryButton}>
            Start the assessment
          </Link>
        ) : null}
      </PersonStrengthsShell>
    );
  }

  if (assessment.status !== "completed") {
    return (
      <PersonStrengthsShell subject={subject} isSelf={isSelf}>
        <p className={styles.prose}>
          {isSelf
            ? "Your assessment is in progress. Finish it and your results will land here."
            : `${subject.first_name}'s assessment is in progress. Their results will appear here once they finish.`}
        </p>
        {isSelf ? (
          <Link href="/strengths/assessment" className={styles.primaryButton}>
            Continue the assessment
          </Link>
        ) : null}
      </PersonStrengthsShell>
    );
  }

  const { data: results } = await supabase
    .from("strengths_results")
    .select("profile, summary")
    .eq("assessment_id", assessment.id)
    .maybeSingle<{ profile: unknown; summary: string }>();

  if (!results) {
    return (
      <PersonStrengthsShell subject={subject} isSelf={isSelf}>
        <p className={styles.prose}>
          The assessment finished but results haven&rsquo;t generated yet.
          {isSelf ? " Reload in a moment." : " Ask them to reload their results page, or try again shortly."}
        </p>
      </PersonStrengthsShell>
    );
  }

  return (
    <>
      <div className={styles.backCrumbBand}>
        <Link href={`/people/${subject.id}`} className={styles.backCrumbLink}>
          ← Back to {subject.full_name.split(" ")[0]}&rsquo;s scorecard
        </Link>
      </div>
      <ResultsView
        firstName={subject.first_name ?? subject.full_name.split(" ")[0] ?? ""}
        results={{
          profile: results.profile as ResultsProfile,
          summary: results.summary,
        }}
        showCoachingLink={false}
      />
    </>
  );
}

function PersonStrengthsShell({
  subject,
  isSelf,
  children,
}: {
  subject: Pick<Profile, "id" | "first_name" | "full_name" | "position">;
  isSelf: boolean;
  children: React.ReactNode;
}) {
  const firstName = subject.first_name ?? subject.full_name.split(" ")[0] ?? "";
  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Strengths results">
        <div className={styles.heroInner}>
          <Link href={`/people/${subject.id}`} className={styles.backCrumbLink}>
            ← Back to {firstName}&rsquo;s scorecard
          </Link>
          <p className={styles.eyebrow}>Strengths results</p>
          <h1 className={styles.h1}>
            {isSelf ? `Your strengths, ${firstName}` : `${subject.full_name}'s strengths`}
          </h1>
          <span className={styles.rule} aria-hidden="true" />
          {subject.position ? (
            <p className={styles.subtitle}>{subject.position}</p>
          ) : null}
        </div>
      </section>
      <div className={styles.content}>
        <section className={styles.card}>{children}</section>
      </div>
    </div>
  );
}
