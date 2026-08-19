import { CompanyNameLink } from "../admin/companies/CompanyNameLink";
import type { CompanyRollup } from "@/lib/hq/service";
import styles from "./hq.module.css";

// Compact per-company row: scorecard, FTR, quarter, last met. Click-
// through scopes into that company via the same server-side flow the
// /admin/companies list uses (CompanyNameLink).
//
// Prepare-for-{company} action lands in Phase 7 alongside the
// Session Brief panel — kept off the row today so the section stays
// server-rendered.

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function YourCompaniesSection({ rows }: { rows: CompanyRollup[] }) {
  return (
    <section className={styles.card} aria-labelledby="hq-companies">
      <h2 id="hq-companies" className={styles.h2}>
        Your companies
      </h2>
      <p className={styles.sectionCaption}>
        Every company in your caseload, with the numbers that matter
        this week.
      </p>
      {rows.length === 0 ? (
        <p className={styles.empty}>No companies assigned.</p>
      ) : (
        <table className={styles.companiesTable}>
          <thead>
            <tr>
              <th>Company</th>
              <th className={styles.companyNumHead}>Scorecard</th>
              <th className={styles.companyNumHead}>Follow-Through</th>
              <th>Open quarter</th>
              <th>Last met</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <CompanyNameLink companyId={row.id} name={row.name} />
                </td>
                <td className={styles.companyNumCell}>
                  {row.scorecardOverall === null
                    ? "—"
                    : `${row.scorecardOverall}/10`}
                </td>
                <td className={styles.companyNumCell}>
                  {row.followThroughRate === null
                    ? "—"
                    : `${row.followThroughRate}%`}
                </td>
                <td>{row.openQuarterLabel ?? "—"}</td>
                <td>{row.lastMet ? formatDateShort(row.lastMet) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
