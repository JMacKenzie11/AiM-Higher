import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { LEAD_LIST_COLUMNS, type LeadListRow } from "@/lib/lead-analysis/types";
import { NewLeadAnalysisForm } from "./NewLeadAnalysisForm";
import { StatusChip } from "./StatusChip";
import { AutoRefresh } from "./AutoRefresh";
import styles from "../admin/companies/admin.module.css";
import lead from "./lead.module.css";

export const metadata = { title: "Meeting Analysis" };

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
  const running = rows.some((r) => r.status === "pending" || r.status === "analyzing");

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
        {running ? <AutoRefresh /> : null}
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
                    <th className={styles.actionHead}>
                      <span className={lead.visuallyHidden}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/meetinganalysis/${r.id}`} className={lead.nameLink}>
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
                      <td>
                        <div className={lead.rowActions}>
                          <Link href={`/meetinganalysis/${r.id}`} className={lead.rowBtn}>
                            View
                          </Link>
                          {r.status === "complete" ? (
                            <>
                              <a
                                href={`/meetinganalysis/${r.id}/pdf?view`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={lead.rowBtn}
                              >
                                Open PDF
                              </a>
                              <a href={`/meetinganalysis/${r.id}/pdf`} className={lead.rowBtn}>
                                Download PDF
                              </a>
                            </>
                          ) : null}
                        </div>
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
