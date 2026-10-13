import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { LEAD_LIST_COLUMNS, type LeadListRow } from "@/lib/lead-analysis/types";
import { NewLeadAnalysisForm } from "./NewLeadAnalysisForm";
import { StatusChip } from "./StatusChip";
import styles from "../admin/companies/admin.module.css";
import lead from "./lead.module.css";

// The free meeting analysis for prospects (0265). System admins only,
// and on no menu: reached by its address (Jason, 2026-10-13).
//
// The analysis runs after the form's response (lead-analysis/actions.ts),
// inside this route's function, so it gets the same ceiling as the
// transcript cron.
export const maxDuration = 300;

export default async function MeetingAnalysisLeadsPage() {
  await requireRole(["system_admin"]);
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await supabase
    .from("lead_meeting_analyses")
    .select(LEAD_LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as LeadListRow[];

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Meeting analysis">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Free meeting analysis</p>
          <h1 className={styles.h1}>Meeting Analysis</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Upload a leadership meeting transcript and get a branded report to review with them and send.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="new-analysis">
          <h2 id="new-analysis" className={styles.h2}>
            New analysis
          </h2>
          <NewLeadAnalysisForm />
        </section>

        <section className={styles.card} aria-labelledby="past-analyses">
          <h2 id="past-analyses" className={styles.h2}>
            Past analyses
          </h2>
          {rows.length === 0 ? (
            <p className={styles.emptyLine}>No analyses yet.</p>
          ) : (
            <div className={lead.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Prepared for</th>
                    <th>Company</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/meetinganalysis/${r.id}`} className={styles.itemLink}>
                          {r.full_name}
                        </Link>
                        <div className={styles.mutedCell}>{r.email}</div>
                      </td>
                      <td>
                        {r.company_name}
                        {r.role_title ? <div className={styles.mutedCell}>{r.role_title}</div> : null}
                      </td>
                      <td>{r.score_overall !== null ? Number(r.score_overall).toFixed(1) : "–"}</td>
                      <td>
                        <StatusChip status={r.status} />
                      </td>
                      <td className={styles.mutedCell}>
                        {new Date(r.created_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
