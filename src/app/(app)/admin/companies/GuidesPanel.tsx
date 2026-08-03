import type { Company } from "@/lib/types";
import type { GuideOverviewRow } from "@/lib/admin/guides-service";
import { CreateGuideForm } from "./CreateGuideForm";
import { GuideRowActions } from "./GuideRowActions";
import styles from "./admin.module.css";

// System-admin surface for managing AiMS Guides. Lists every guide,
// which companies they're assigned to, and provides row-level
// actions (assign to another company, unassign, delete) plus a
// create form. Not rendered for aims_guides or company_admins.

export function GuidesPanel({
  guides,
  companies,
}: {
  guides: GuideOverviewRow[];
  companies: Pick<Company, "id" | "name">[];
}) {
  return (
    <section className={styles.card} aria-labelledby="aims-guides">
      <h2 id="aims-guides" className={styles.h2}>
        AiMS Guides
      </h2>
      <p className={styles.subtitleInline}>
        Guides act as company admins on the companies they coach. They
        can&rsquo;t create or archive companies. Every guide must be
        assigned to at least one company.
      </p>

      {guides.length === 0 ? (
        <p className={styles.emptyLine}>No guides yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Guide</th>
              <th>Companies</th>
              <th className={styles.actionHead}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {guides.map((g) => (
              <tr key={g.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{g.full_name}</div>
                </td>
                <td>
                  {g.assignments.length === 0 ? (
                    <span className={styles.mutedCell}>
                      (no assignments — will be prompted to pick one on sign-in)
                    </span>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {g.assignments.map((a) => (
                        <li key={a.company_id}>{a.company_name}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  <GuideRowActions
                    guideId={g.id}
                    assignedCompanyIds={g.assignments.map((a) => a.company_id)}
                    allCompanies={companies}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: "var(--space-4)" }}>
        <h3 className={styles.h3}>Add a guide</h3>
        <CreateGuideForm companies={companies} />
      </div>
    </section>
  );
}
