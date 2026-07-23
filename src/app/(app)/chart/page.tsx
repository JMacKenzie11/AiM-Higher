import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import {
  getChartTree,
  type ChartFunction,
  type ChartLtd,
} from "@/lib/chart/service";
import { AddFunctionForm, AddOutcomeForm, AddMeasureForm } from "./InlineForms";
import styles from "./chart.module.css";

// Chart — how we run the business. Rendered as an org-chart of
// function boxes. Each box: Function name → LTD trio → outcomes with
// their success measures + targets. Sub-functions render below their
// parent, connected by a CSS-based branch line.

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
          value — with the LTD (Lead / Track / Decide) for each and the
          success measures that prove the outcomes.
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
        <div className={styles.chartGrid}>
          {roots.map((fn) => (
            <FunctionBranch key={fn.id} fn={fn} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

// A branch = a function card plus any sub-functions rendered
// beneath it and connected by the .branchConnector line.
function FunctionBranch({
  fn,
  isAdmin,
}: {
  fn: ChartFunction;
  isAdmin: boolean;
}) {
  return (
    <div className={styles.branchWrap}>
      <FunctionBox fn={fn} isAdmin={isAdmin} />
      {fn.children.length > 0 ? (
        <div className={styles.branchConnector}>
          {fn.children.map((child) => (
            <FunctionBranch key={child.id} fn={child} isAdmin={isAdmin} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FunctionBox({ fn, isAdmin }: { fn: ChartFunction; isAdmin: boolean }) {
  const overThreeOutcomes = fn.outcomes.length > 3;
  return (
    <article className={styles.fnCard}>
      <header className={styles.fnHeader}>
        <p className={styles.fnEyebrow}>Function</p>
        <h2 className={styles.fnTitle}>
          <Link href={`/chart/function/${fn.id}`}>{fn.title}</Link>
        </h2>
        {fn.description ? (
          <p className={styles.fnDescription}>{fn.description}</p>
        ) : null}
      </header>

      <LtdRow ltd={fn.ltd} />

      {fn.outcomes.length === 0 ? (
        <div className={styles.outcomeBlock}>
          <p className={styles.emptyOutcomeLine}>No outcomes yet.</p>
        </div>
      ) : (
        fn.outcomes.map((o) => (
          <section key={o.id} className={styles.outcomeBlock}>
            <p className={styles.outcomeLabel}>Outcome</p>
            <h3 className={styles.outcomeTitle}>{o.title}</h3>
            {o.measures.length === 0 ? (
              <p className={styles.emptyOutcomeLine}>
                No success measures yet.
                {isAdmin ? " Add one below to start tracking." : ""}
              </p>
            ) : (
              <ul className={styles.measureList}>
                {o.measures.map((m) => (
                  <li key={m.id} className={styles.measureRow}>
                    <span className={styles.measureDesc}>{m.description}</span>
                    <span className={styles.measureTarget}>
                      {m.target ? `Target ${formatWithType(m.target, m.value_type)}` : "No target"}
                    </span>
                    <span
                      className={
                        m.latestEntry
                          ? styles.measureValue
                          : `${styles.measureValue} ${styles.measureValueEmpty}`
                      }
                      title={m.latestEntry ? `Week of ${m.latestEntry.week_ending}` : "No entries yet"}
                    >
                      {formatLatestValue(m)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {isAdmin ? (
              <details className={styles.addDetails} style={{ marginTop: "var(--space-3)" }}>
                <summary className={styles.addSummary}>+ Add measure</summary>
                <AddMeasureForm outcomeId={o.id} />
              </details>
            ) : null}
          </section>
        ))
      )}

      {overThreeOutcomes ? (
        <div className={styles.outcomeBlock}>
          <p className={styles.focusWarning}>
            <strong>Focus reminder:</strong> {fn.outcomes.length} outcomes on
            this function. We recommend keeping it to three.
          </p>
        </div>
      ) : null}

      {isAdmin ? (
        <footer className={styles.fnFooter}>
          <details className={styles.addDetails}>
            <summary className={styles.addSummary}>+ Add outcome</summary>
            <AddOutcomeForm functionId={fn.id} />
          </details>
        </footer>
      ) : null}
    </article>
  );
}

function LtdRow({ ltd }: { ltd: ChartLtd }) {
  const cells: Array<{ label: string; person: ChartLtd["lead"] }> = [
    { label: "Lead", person: ltd.lead },
    { label: "Track", person: ltd.track },
    { label: "Decide", person: ltd.decide },
  ];
  return (
    <div className={styles.ltdRow}>
      {cells.map((c) => (
        <div key={c.label} className={styles.ltdCell}>
          <span className={styles.ltdLabel}>{c.label}</span>
          <span
            className={
              c.person ? styles.ltdName : `${styles.ltdName} ${styles.ltdNameEmpty}`
            }
          >
            {c.person?.full_name ?? "Unassigned"}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatWithType(target: string, valueType: "number" | "percent" | "text"): string {
  if (valueType === "percent") {
    const numeric = target.replace(/[^0-9.\-]/g, "");
    return numeric ? `${numeric}%` : target;
  }
  return target;
}

function formatLatestValue(m: ChartFunction["outcomes"][number]["measures"][number]): React.ReactNode {
  const latest = m.latestEntry;
  if (!latest) return "—";
  if (m.value_type === "text") return latest.value_text ?? "—";
  const n = latest.value_number;
  if (n === null || !Number.isFinite(n)) return "—";
  if (m.value_type === "percent") return `${n}%`;
  return n.toString();
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
