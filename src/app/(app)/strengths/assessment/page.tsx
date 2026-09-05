import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import AssessmentFlow from "./AssessmentFlow";
import type { Item } from "@/lib/strengths/types";
import styles from "../strengths.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

export default async function AssessmentPage() {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, position")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/sign-in");

  // No company_id guard here — sysadmins take the assessment without
  // one (migration 0123). If there's no in-progress assessment we
  // bounce to /welcome, which handles the "start it" affordance and
  // its own eligibility rules for non-sysadmin no-company users.
  const { data: assessment } = await supabase
    .from("strengths_assessments")
    .select("id, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!assessment) redirect("/strengths/welcome");
  if (assessment.status === "completed") redirect("/strengths/results");

  const { data: items } = await supabase
    .from("strengths_items")
    .select("*")
    .order("sort_order", { ascending: true });

  const { data: responses } = await supabase
    .from("strengths_responses")
    .select("item_id, value")
    .eq("assessment_id", assessment.id);

  const { data: narrative } = await supabase
    .from("strengths_narrative_messages")
    .select("role, content, created_at")
    .eq("assessment_id", assessment.id)
    .order("created_at", { ascending: true });

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Assessment in progress">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>The AiMS Strengths Assessment</p>
          <h1 className={styles.h1}>Keep going, {profile.first_name}.</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            First-instinct answers work best. You can step back to revise, or
            forward through anything you&rsquo;ve already answered.
          </p>
        </div>
      </section>
      <AssessmentFlow
        assessmentId={assessment.id}
        items={(items ?? []) as Item[]}
        existingResponses={responses ?? []}
        existingNarrative={narrative ?? []}
        firstName={profile.first_name}
      />
    </div>
  );
}
