"use client";

import { useState } from "react";
import { CompanyNameLink } from "../admin/companies/CompanyNameLink";
import type { CompanyRollup } from "@/lib/hq/service";
import type { SessionBriefRow } from "@/lib/hq/brief";
import { PrepareBriefPanel } from "./PrepareBriefPanel";
import styles from "./hq.module.css";

// Compact per-company row: scorecard, FTR, quarter, last met. Click-
// through scopes into that company via the same server-side flow the
// /admin/companies list uses (CompanyNameLink).
//
// "Prepare for {company}" opens a dialog that generates a Session
// Brief on demand. Available on both the guide's own /hq view and the
// sysadmin oversight view (has no side effects — generating a brief
// is additive and the brief author is always the caller, not the
// guide being viewed).

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function YourCompaniesSection({
  rows,
  recentBriefsByCompany,
}: {
  rows: CompanyRollup[];
  // Map of the two most recent briefs per company visible to the
  // caller. Empty maps are fine — the panel offers to generate the
  // first one.
  recentBriefsByCompany: Record<string, SessionBriefRow[]>;
}) {
  const [prepareFor, setPrepareFor] = useState<CompanyRollup | null>(null);

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
              <th aria-label="Session brief" />
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
                <td className={styles.actionsCell}>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => setPrepareFor(row)}
                    title={`Prepare for ${row.name}`}
                  >
                    Prepare for {row.name}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {prepareFor ? (
        <PrepareBriefPanel
          companyId={prepareFor.id}
          companyName={prepareFor.name}
          initialBriefs={recentBriefsByCompany[prepareFor.id] ?? []}
          onClose={() => setPrepareFor(null)}
        />
      ) : null}
    </section>
  );
}
