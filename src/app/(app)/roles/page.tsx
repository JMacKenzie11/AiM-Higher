import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { listRoleDescriptions } from "@/lib/role-descriptions/roles-list";
import { PageShell } from "@/components/ui/PageShell";
import styles from "./roles.module.css";

// Every role description the company has written, on-chart and off.
//
// It exists because the off-chart ones have nowhere else to live. A
// role description for a seat on the chart is reachable from that
// function; one for a role that is deliberately not on the chart is
// reachable from nothing, and a document you cannot find is a
// document you wrote once.
//
// Gated on role_descriptions, the same flag as the agent that
// writes them, so the surface and the thing that fills it switch on
// together. Without the flag this route does not exist rather than
// rendering an empty state about a feature the company has not got.

export default async function RolesPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  if (!(await companyHasFeature(companyId, "role_descriptions"))) notFound();

  const rows = await listRoleDescriptions(companyId);

  return (
    <PageShell
      eyebrow="Company"
      title="Role Descriptions"
      subtitle="What each seat owns, what it is held to, and what excellence looks like in it. Written with Aimee, saved here."
    >
      {rows.length === 0 ? (
        <section className={styles.emptyCard}>
          <p className={styles.emptyLead}>No role descriptions yet.</p>
          <p className={styles.emptyLine}>
            Ask Aimee to write one. She works from your Functional Chart and
            your One-Page Plan, and asks you the rest.
          </p>
          <Link href="/ask-aimee" className={styles.emptyAction}>
            Start one →
          </Link>
        </section>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.roleId} className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>
                  {/* A row for an on-chart role links to that
                      function's document page, which is where its
                      versions live. An off-chart one has no such
                      page, so it stays a plain line rather than a
                      link that goes nowhere. */}
                  {row.functionId ? (
                    <Link
                      href={`/chart/function/${row.functionId}/role-description`}
                      className={styles.rowLink}
                    >
                      {row.title}
                    </Link>
                  ) : (
                    row.title
                  )}
                </p>
                <p className={styles.rowPlacement}>
                  {row.functionId ? (
                    <>On the chart</>
                  ) : row.supportsFunctions.length > 0 ? (
                    <>Not on the chart. Supports {row.supportsFunctions.join(", ")}</>
                  ) : (
                    <>Not on the chart</>
                  )}
                </p>
                {row.doc === null ? (
                  <p className={styles.rowBroken}>
                    This version can&rsquo;t be read. Ask Aimee for a fresh one.
                  </p>
                ) : row.doc.why_this_role_exists ? (
                  <p className={styles.rowLine}>
                    {firstSentence(row.doc.why_this_role_exists)}
                  </p>
                ) : null}
              </div>
              <div className={styles.rowMeta}>
                <span className={styles.version}>v{row.versionNumber}</span>
                <span className={styles.metaLine}>
                  {formatDay(row.updatedAt)}
                  {row.authorName ? ` · ${row.authorName}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

// One sentence, so the list reads as a list. The whole section is
// two or three paragraphs and belongs on the document, not here.
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const end = trimmed.search(/[.!?](\s|$)/);
  return end === -1 ? trimmed : trimmed.slice(0, end + 1);
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
