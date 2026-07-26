import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getChartTree,
  type ChartFunction,
} from "@/lib/chart/service";
import { AddFunctionForm } from "./InlineForms";
import styles from "./chart.module.css";

// Chart — an org-chart tree of the company's functions.
//
// Each function box carries the minimum needed to read the shape of
// the org at a glance: function name, who's in the seat, and the
// outcomes the function is obsessed with delivering. LTD (Lead /
// Track / Decide) are three responsibilities of the one seat holder,
// not three separate assignments — so we show one name, not three.
// Success measures + weekly values live on the function's detail
// page; keeping them off the chart is what lets the chart stay a
// chart.

export default async function ChartPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle<{ name: string }>();

  const { roots, roster } = await getChartTree(companyId);

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Chart</h1>
        <span className="aims-rule" aria-hidden="true" />
        <p className={styles.subtitle}>
          The functions that run the business. Each box shows who&rsquo;s in the
          seat and what they&rsquo;re obsessed with delivering. Click a
          function to see its success measures.
        </p>
      </header>

      {isAdmin ? (
        <div className={styles.toolbar}>
          <details className={styles.addDetails}>
            <summary className={styles.addSummary}>+ Add function</summary>
            <div style={{ marginTop: "var(--space-3)" }}>
              <AddFunctionForm people={roster} />
            </div>
          </details>
        </div>
      ) : null}

      {roots.length === 0 ? (
        <EmptyChart isAdmin={isAdmin} />
      ) : (
        <div className={styles.tree}>
          <ul className={styles.treeBranch}>
            <li className={styles.treeNode}>
              <div className={styles.companyRoot}>
                <span className={styles.companyRootLabel}>Company</span>
                <h2 className={styles.companyRootTitle}>
                  {company?.name ?? "Chart"}
                </h2>
              </div>
              <ul className={styles.treeBranch}>
                {roots.map((fn) => (
                  <FunctionBranch key={fn.id} fn={fn} />
                ))}
              </ul>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

function FunctionBranch({ fn }: { fn: ChartFunction }) {
  return (
    <li className={styles.treeNode}>
      <FunctionBox fn={fn} />
      {fn.children.length > 0 ? (
        <ul className={styles.treeBranch}>
          {fn.children.map((child) => (
            <FunctionBranch key={child.id} fn={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function FunctionBox({ fn }: { fn: ChartFunction }) {
  return (
    <Link href={`/chart/function/${fn.id}`} style={{ textDecoration: "none" }}>
      <article className={styles.fnCard}>
        <header className={styles.fnHeader}>
          <h3 className={styles.fnTitle}>{fn.title}</h3>
        </header>
        <div className={styles.fnSeat}>
          <span className={styles.fnSeatLabel}>Seat</span>
          <span
            className={
              fn.seatHolder
                ? styles.fnSeatName
                : `${styles.fnSeatName} ${styles.fnSeatEmpty}`
            }
          >
            {fn.seatHolder?.full_name ?? "Unassigned"}
          </span>
        </div>
        {fn.outcomes.length > 0 ? (
          <div className={styles.outcomeBlock}>
            <p className={styles.outcomeLabel}>Obsessed with</p>
            <ul className={styles.outcomeList}>
              {fn.outcomes.map((o) => (
                <li key={o.id} className={styles.outcomeItem}>
                  {o.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>
    </Link>
  );
}

function EmptyChart({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section className={styles.emptyCard}>
      <p className={styles.emptyLead}>No functions yet.</p>
      <p className={styles.emptyLine}>
        {isAdmin
          ? "Start with the three or four functions your business needs — Field Operations, Preconstruction, Safety, Finance — and add the outcomes each one is on the hook for."
          : "Your company admin hasn't set up the chart yet."}
      </p>
    </section>
  );
}
