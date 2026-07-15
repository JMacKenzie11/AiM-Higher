import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { getCompaniesOverview } from "@/lib/admin/companies-service";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { CompanyNameLink } from "./CompanyNameLink";
import { CompanyRowActions } from "./CompanyRowActions";
import { CreateCompanyForm } from "./CreateCompanyForm";
import styles from "./admin.module.css";

// System-admin Companies overview — the fleet view.
//   Clicking a company name scopes into it and jumps straight to its
//   dashboard (see CompanyNameLink). Per-row Settings link goes to
//   /admin/companies/[id] for archive + people admin. Create form
//   lives below the list.

export default async function AdminCompaniesPage() {
  await requireRole(["system_admin"]);
  const companies = await getCompaniesOverview();

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Companies summary">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>System admin</p>
          <h1 className={styles.h1}>Companies</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Every company on the AiMSHigher Platform. Click a name to
            jump into its dashboard.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="companies-list">
          <h2 id="companies-list" className={styles.h2}>
            All companies
          </h2>
          {companies.length === 0 ? (
            <p className={styles.emptyLine}>
              No companies yet. Create the first one below.
            </p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th className={styles.numHead}>People</th>
                  <th>Open quarter</th>
                  <th>Follow-through rate</th>
                  <th>Status</th>
                  <th className={styles.actionHead}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <CompanyNameLink
                        companyId={company.id}
                        name={company.name}
                      />
                      <p className={styles.companyMeta}>{company.timezone}</p>
                    </td>
                    <td className={`${styles.numCell} aims-tabular`}>
                      {company.peopleCount}
                    </td>
                    <td className={styles.mutedCell}>
                      {company.openQuarterLabel ?? "—"}
                    </td>
                    <td className={styles.keepRateCell}>
                      <ProgressBar
                        percent={company.keepRate}
                        label="No resolved commitments"
                      />
                    </td>
                    <td>
                      <span
                        className={
                          company.status === "active"
                            ? styles.chipActive
                            : styles.chipInactive
                        }
                      >
                        {company.status}
                      </span>
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <Link
                          href={`/admin/companies/${company.id}`}
                          className={styles.ghostButton}
                        >
                          Settings
                        </Link>
                        <CompanyRowActions
                          companyId={company.id}
                          status={company.status}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.card} aria-labelledby="create-company">
          <h2 id="create-company" className={styles.h2}>
            Create a new company
          </h2>
          <CreateCompanyForm />
        </section>
      </div>
    </div>
  );
}
