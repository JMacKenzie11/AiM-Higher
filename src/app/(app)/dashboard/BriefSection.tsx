import { getLatestDashboardBrief, getOrGenerateDashboardBrief } from "@/lib/dashboard/brief";
import styles from "./brief.module.css";

// The week in review on the Dashboard's This week tab: a navy panel
// holding the title, beside the summary on white, in the Scoreboard
// design (Jason, 2026-11-21). The summary's first sentence leads.
//
// canGenerate: an admin generates and stores today's brief; everyone
// else in the company reads the latest one written (0253). Wrapped in
// <Suspense> by the page, so the rest renders while the model runs.

export async function BriefSection({
  companyId,
  adminId,
  canGenerate,
}: {
  companyId: string;
  adminId: string;
  canGenerate: boolean;
}) {
  const brief = canGenerate
    ? await getOrGenerateDashboardBrief(companyId, adminId)
    : await getLatestDashboardBrief(companyId);
  const [lead, rest] = brief ? splitLead(brief.content.trim()) : ["", ""];
  return (
    <BriefTile id="brief-card" stamp={brief ? `Refreshed ${formatRelative(brief.generatedAt)}` : null}>
      {brief ? (
        <p className={styles.text}>
          <span className={styles.lead}>{lead}</span>
          {rest ? ` ${rest}` : null}
        </p>
      ) : (
        <p className={styles.quiet}>No brief yet. It&rsquo;ll appear here once there&rsquo;s enough activity this week.</p>
      )}
    </BriefTile>
  );
}

// Streams first while BriefSection awaits the model.
export function BriefLoading() {
  return (
    <BriefTile id="brief-card-loading" stamp={null}>
      <p className={styles.quiet}>
        <span className={styles.dots} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        Reading the week…
      </p>
    </BriefTile>
  );
}

function BriefTile({ id, stamp, children }: { id: string; stamp: string | null; children: React.ReactNode }) {
  return (
    <section className={styles.tile} aria-labelledby={id}>
      <div className={styles.side}>
        <p className={styles.eyebrow}>
          <span className={styles.dot} aria-hidden="true" />
          Week in review
        </p>
        <h2 id={id} className={styles.title}>
          What&rsquo;s worth knowing today
        </h2>
        {stamp ? <span className={styles.stamp}>{stamp}</span> : null}
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

// The first sentence, and everything after it. A brief with no sentence
// break leads with the whole of itself.
export function splitLead(content: string): [string, string] {
  const m = content.match(/^(.+?[.!?])\s+(\S[\s\S]*)$/);
  return m ? [m[1], m[2]] : [content, ""];
}

function formatRelative(iso: string): string {
  const diffMinutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
