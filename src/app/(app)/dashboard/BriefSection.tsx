import { getOrGenerateDashboardBrief } from "@/lib/dashboard/brief";
import { CardAccent } from "@/components/ui/CardAccent";
import { AiBrief } from "./AiBrief";
import styles from "./dashboard.module.css";

// Server component that fetches (and possibly generates) the daily
// AI brief. Wrapped in <Suspense> from the dashboard so the rest of
// the page renders immediately while this suspends on the model call.

export async function BriefSection({
  companyId,
  adminId,
}: {
  companyId: string;
  adminId: string;
}) {
  const brief = await getOrGenerateDashboardBrief(companyId, adminId);
  return (
    <section className={styles.briefCard} aria-labelledby="brief-card">
      <CardAccent />
      <p className={styles.briefEyebrow}>
        <span className={styles.briefEyebrowDot} aria-hidden="true" />
        Week in review
      </p>
      <h2 id="brief-card" className={styles.briefTitle}>
        What&rsquo;s worth knowing today
      </h2>
      {brief ? (
        <AiBrief content={brief.content} generatedAt={brief.generatedAt} />
      ) : (
        <p className={styles.briefEmpty}>
          No brief yet — it&rsquo;ll appear here once there&rsquo;s enough
          activity this week (and the coach API key is configured).
        </p>
      )}
    </section>
  );
}

// Placeholder that streams first while BriefSection awaits the model.
export function BriefLoading() {
  return (
    <section className={styles.briefCard} aria-labelledby="brief-card-loading">
      <CardAccent />
      <p className={styles.briefEyebrow}>
        <span className={styles.briefEyebrowDot} aria-hidden="true" />
        Week in review
      </p>
      <h2 id="brief-card-loading" className={styles.briefTitle}>
        What&rsquo;s worth knowing today
      </h2>
      <p className={styles.briefLoading}>
        <span className={styles.briefLoadingDots} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        Getting daily brief…
      </p>
    </section>
  );
}
