import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getChartTree,
  type ChartFunction,
  type ChartLtd,
} from "@/lib/chart/service";
import { AddFunctionForm, AddOutcomeForm, AddMeasureForm } from "./InlineForms";
import styles from "./chart.module.css";

// Chart — an org-chart tree of the company's functions.
// Company at the root; functions branch below with L-shaped
// connector lines; sub-functions cascade further. Each function
// box shows LTD (Lead / Track / Decide) and the outcomes with
// their success measures.

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
          How we run the business. Each function shows LTD (Lead / Track /
          Decide) and the success measures that prove its outcomes.
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
          <ul>
            <li>
              <div className={styles.companyRoot}>
                <span className={styles.companyRootLabel}>Company</span>
                <h2 className={styles.companyRootTitle}>
                  {company?.name ?? "Chart"}
                </h2>
              </div>
              <ul>
                {roots.map((fn) => (
                  <FunctionBranch key={fn.id} fn={fn} isAdmin={isAdmin} />
                ))}
              </ul>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

// A branch = a function box, plus a nested <ul> of its sub-functions
// if any. The CSS tree scaffold takes care of the connector lines.
function FunctionBranch({
  fn,
  isAdmin,
}: {
  fn: ChartFunction;
  isAdmin: boolean;
}) {
  return (
    <li>
      <FunctionBox fn={fn} isAdmin={isAdmin} />
      {fn.children.length > 0 ? (
        <ul>
          {fn.children.map((child) => (
            <FunctionBranch key={child.id} fn={child} isAdmin={isAdmin} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function FunctionBox({ fn, isAdmin }: { fn: ChartFunction; isAdmin: boolean }) {
  const overThreeOutcomes = fn.outcomes.length > 3;
  return (
    <article className={styles.fnCard}>
      <header className={styles.fnHeader}>
        <p className={styles.fnEyebrow}>Function</p>
        <h3 className={styles.fnTitle}>
          <Link href={`/chart/function/${fn.id}`}>{fn.title}</Link>
        </h3>
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
            <h4 className={styles.outcomeTitle}>{o.title}</h4>
            {o.measures.length === 0 ? (
              <p className={styles.emptyOutcomeLine}>No success measures yet.</p>
            ) : (
              <ul className={styles.measureList}>
                {o.measures.map((m) => (
                  <li key={m.id} className={styles.measureRow}>
                    <span className={styles.measureDesc}>{m.description}</span>
                    <div className={styles.measureTargets}>
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
                      {m.target ? (
                        <span className={styles.measureTarget}>
                          Target {formatWithType(m.target, m.value_type)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {isAdmin ? (
              <details className={styles.addDetails} style={{ marginTop: "var(--space-2)" }}>
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
            title={c.person?.full_name ?? "Unassigned"}
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
