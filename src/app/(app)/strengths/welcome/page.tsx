import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import StartAssessmentButton from "./StartAssessmentButton";
import styles from "../strengths.module.css";

export default async function WelcomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, role, company_id")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/sign-in");

  const { data: existing } = await supabase
    .from("strengths_assessments")
    .select("id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing?.status === "completed") redirect("/strengths/results");
  if (existing?.status === "in_progress") redirect("/strengths/assessment");

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Assessment welcome">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>The AiMS Strengths Assessment</p>
          <h1 className={styles.h1}>Welcome, {profile.first_name}.</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            About ten to twelve minutes. Not a grading exercise — a signal
            about where your energy already is.
          </p>
        </div>
      </section>

      <div className={`${styles.content} ${styles.contentProse}`}>
        <section className={styles.card} aria-labelledby="what-to-expect">
          <h2 id="what-to-expect" className={styles.h2}>
            What to expect
          </h2>
          <p className={styles.prose}>
            You&rsquo;ll rate a set of statements, choose between a few paired
            options, and answer a couple of questions in your own words. Some
            things you&rsquo;ll agree with strongly, others you won&rsquo;t.
            Both tell us something useful about how your energy is configured.
          </p>
          <p className={styles.prose}>
            A low score isn&rsquo;t a weakness — it&rsquo;s a signal about
            where your energy is better spent elsewhere. The whole picture is
            what matters, not any single answer.
          </p>
          <StartAssessmentButton
            userId={user.id}
            companyId={profile.company_id}
          />
        </section>
      </div>
    </div>
  );
}
