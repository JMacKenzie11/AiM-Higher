import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { entryKey, getScorecardData } from "@/lib/scorecard/service";
import { formatShortDate } from "@/lib/dates";
import { ScorecardCell } from "./ScorecardCell";
import { AddAreaForm } from "./AddAreaForm";
import { AddMetricForm } from "./AddMetricForm";
import styles from "./scorecard.module.css";

// Functional Scorecard — Section 8.5.

export default async function ScorecardPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const data = await getScorecardData(companyId, session.profile.id);
  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  const hasAnyAreas = data.areas.length > 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Functional Scorecard</h1>
        <span className="aims-rule" aria-hidden="true" />
        <p className={styles.subtitle}>
          Weekly signals across every function. Last 13 weeks, newest first.
        </p>
      </header>

      {!hasAnyAreas ? (
        <EmptyState />
      ) : (
        <div className={styles.gridWrap}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={`${styles.stickyCol} ${styles.stickyArea}`}>
                  Functional area
                </th>
                <th className={`${styles.stickyCol} ${styles.stickyMetric}`}>
                  Metric
                </th>
                <th className={`${styles.stickyCol} ${styles.stickyTarget}`}>
                  Target
                </th>
                {data.weeks.map((week) => (
                  <th key={week} className={styles.weekHead}>
                    {formatShortDate(week)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.areas.map((area) => {
                const canEditAreaEntries =
                  isAdmin ||
                  data.callerIsAccountableForAreaIds.has(area.id);

                if (area.metrics.length === 0) {
                  return (
                    <tr key={area.id}>
                      <th
                        className={`${styles.stickyCol} ${styles.stickyArea} ${styles.areaCell}`}
                      >
                        <div className={styles.areaName}>{area.name}</div>
                        <div className={styles.areaAccountable}>
                          {area.accountable?.full_name ?? "No accountable"}
                        </div>
                      </th>
                      <td
                        className={`${styles.stickyCol} ${styles.stickyMetric}`}
                        colSpan={2 + data.weeks.length}
                      >
                        <span className={styles.emptyMetricLine}>
                          No metrics yet.
                          {isAdmin
                            ? " Use “+ Add metric” below."
                            : ""}
                        </span>
                      </td>
                    </tr>
                  );
                }

                return area.metrics.map((metric, index) => (
                  <tr key={metric.id}>
                    {index === 0 ? (
                      <th
                        rowSpan={area.metrics.length}
                        className={`${styles.stickyCol} ${styles.stickyArea} ${styles.areaCell}`}
                      >
                        <div className={styles.areaName}>{area.name}</div>
                        <div className={styles.areaAccountable}>
                          {area.accountable?.full_name ?? "No accountable"}
                        </div>
                      </th>
                    ) : null}
                    <td className={`${styles.stickyCol} ${styles.stickyMetric}`}>
                      <div className={styles.metricName}>{metric.name}</div>
                      <div className={styles.metricType}>
                        {metric.value_type}
                      </div>
                    </td>
                    <td
                      className={`${styles.stickyCol} ${styles.stickyTarget} ${styles.targetCell} aims-tabular`}
                    >
                      {metric.target ?? "—"}
                    </td>
                    {data.weeks.map((week) => {
                      const entry = data.entries.get(entryKey(metric.id, week));
                      return (
                        <ScorecardCell
                          key={week}
                          metricId={metric.id}
                          weekEnding={week}
                          valueType={metric.value_type}
                          target={metric.target}
                          initialValue={
                            entry?.value_text ??
                            (entry?.value_number !== null &&
                            entry?.value_number !== undefined
                              ? String(entry.value_number)
                              : "")
                          }
                          canEdit={canEditAreaEntries}
                        />
                      );
                    })}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin ? (
        <div className={styles.adminGrid}>
          <section className={styles.card} aria-labelledby="add-area">
            <h2 id="add-area" className={styles.h3}>
              + Add functional area
            </h2>
            <AddAreaForm roster={data.roster} />
          </section>
          {hasAnyAreas ? (
            <section className={styles.card} aria-labelledby="add-metric">
              <h2 id="add-metric" className={styles.h3}>
                + Add metric
              </h2>
              <AddMetricForm areas={data.areas} />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className={styles.emptyTile}>
      <p className={styles.emptyTileText}>
        Metrics turn opinions into signals. Add your first functional area.
      </p>
    </div>
  );
}
