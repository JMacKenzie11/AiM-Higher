import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getChartTree, type ChartFunction } from "@/lib/chart/service";
import { AddFunctionForm, AddOutcomeForm, AddMeasureForm } from "./InlineForms";
import styles from "./chart.module.css";

// Chart — how we run the business. Functions are capabilities the
// company needs; each has Outcomes it is obsessed with delivering;
// each outcome has Success Measures that prove it. Parallel to /plan
// ("change the business") — commitments spawn from missed measures.

export default async function ChartPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

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
          The company&rsquo;s functions — the capabilities we need to deliver
          value — with the outcomes each one is on the hook for and the
          measures that prove them.
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
          {roots.map((fn) => (
            <FunctionCard key={fn.id} fn={fn} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

function FunctionCard({ fn, isAdmin }: { fn: ChartFunction; isAdmin: boolean }) {
  const outcomeCount = fn.outcomes.length;
  const overThree = outcomeCount > 3;
  return (
    <article className={styles.functionCard}>
      <div className={styles.functionSummary}>
        <div>
          <span className={styles.functionEyebrow}>Function</span>
          <h2 className={styles.functionTitle}>
            <Link href={`/chart/function/${fn.id}`}>{fn.title}</Link>
          </h2>
          <p className={styles.functionLeader}>
            Leader: {fn.leader?.full_name ?? "Unassigned"}
          </p>
        </div>
      </div>

      {fn.description ? (
        <p className={styles.functionDescription}>{fn.description}</p>
      ) : null}

      {overThree ? (
        <p className={styles.focusWarning}>
          <strong>Focus reminder:</strong> {outcomeCount} outcomes on this
          function. We recommend keeping it to three — anything a function is
          obsessed with delivering should live at the top of the list, and
          everything else should either fold in or move.
        </p>
      ) : null}

      {fn.outcomes.length > 0 ? (
        <ul className={styles.outcomeList}>
          {fn.outcomes.map((o) => (
            <li key={o.id} className={styles.outcomeItem}>
              <div className={styles.outcomeHeader}>
                <div>
                  <span className={styles.outcomeEyebrow}>Outcome</span>
                  <h3 className={styles.outcomeTitle}>{o.title}</h3>
                </div>
              </div>

              {o.measures.length > 0 ? (
                <ul className={styles.measureList}>
                  {o.measures.map((m) => (
                    <li key={m.id} className={styles.measureItem}>
                      <div className={styles.measureDescription}>{m.description}</div>
                      <div className={styles.measureTarget}>
                        {m.target ? `Target: ${m.target}` : "No target set"}
                      </div>
                      <div className={styles.measureValue}>
                        {formatMeasureValue(m)}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}

              {isAdmin ? (
                <details className={styles.addDetails}>
                  <summary className={styles.addSummary}>+ Add measure</summary>
                  <AddMeasureForm outcomeId={o.id} />
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.emptyLine}>No outcomes yet.</p>
      )}

      {isAdmin ? (
        <details className={styles.addDetails}>
          <summary className={styles.addSummary}>+ Add outcome</summary>
          <AddOutcomeForm functionId={fn.id} />
        </details>
      ) : null}

      {fn.children.length > 0 ? (
        <div className={styles.children}>
          {fn.children.map((child) => (
            <FunctionCard key={child.id} fn={child} isAdmin={isAdmin} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function formatMeasureValue(m: ChartFunction["outcomes"][number]["measures"][number]): React.ReactNode {
  const latest = m.latestEntry;
  if (!latest) return <span className={styles.measureValueMuted}>—</span>;
  if (m.value_type === "text") {
    return latest.value_text ?? <span className={styles.measureValueMuted}>—</span>;
  }
  const n = latest.value_number;
  if (n === null || !Number.isFinite(n)) {
    return <span className={styles.measureValueMuted}>—</span>;
  }
  if (m.value_type === "percent") return `${n}%`;
  return n.toString();
}

function EmptyChart({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section className={styles.emptyCard}>
      <p className={styles.emptyLead}>No functions yet.</p>
      <p className={styles.emptyLine}>
        {isAdmin
          ? "Start with the top three or four functions your business needs — Field Operations, Preconstruction, Safety, Finance — and add the outcomes each one is on the hook for."
          : "Your company admin hasn't set up the chart yet."}
      </p>
    </section>
  );
}
