import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { AddOutcomeForm, AddMeasureForm } from "../../InlineForms";
import styles from "../../chart.module.css";

// Function detail — the whole story for a single function: leader,
// parent link, sub-functions, outcomes, measures, entry history.

type PageProps = { params: Promise<{ id: string }> };

export default async function ChartFunctionDetailPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getChartFunctionDetail(id);
  if (!detail) notFound();

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  const outcomeCount = detail.outcomes.length;

  return (
    <div className={styles.detailStage}>
      <div>
        <Link href="/chart" className={styles.crumb}>
          ← Back to chart
        </Link>
      </div>

      <header className={styles.header}>
        <span className={styles.functionEyebrow}>Function</span>
        <h1 className={styles.h1}>{detail.fn.title}</h1>
        <span className="aims-rule" aria-hidden="true" />
        <p className={styles.functionLeader}>
          Leader: {detail.leader?.full_name ?? "Unassigned"}
          {detail.parent ? (
            <>
              {" · Part of "}
              <Link href={`/chart/function/${detail.parent.id}`} className={styles.crumb}>
                {detail.parent.title}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      {detail.fn.description ? (
        <p className={styles.functionDescription}>{detail.fn.description}</p>
      ) : null}

      {outcomeCount > 3 ? (
        <p className={styles.focusWarning}>
          <strong>Focus reminder:</strong> {outcomeCount} outcomes on this
          function. Three or fewer is the norm — everything else should either
          fold in or move.
        </p>
      ) : null}

      <section className={styles.tree}>
        {detail.outcomes.map((o) => (
          <article key={o.id} className={styles.outcomeItem}>
            <div className={styles.outcomeHeader}>
              <div>
                <span className={styles.outcomeEyebrow}>Outcome</span>
                <h2 className={styles.outcomeTitle}>{o.title}</h2>
                {o.description ? (
                  <p className={styles.functionDescription}>{o.description}</p>
                ) : null}
              </div>
            </div>

            {o.measures.length > 0 ? (
              <ul className={styles.measureList}>
                {o.measures.map((m) => {
                  const latest = m.entries[0] ?? null;
                  return (
                    <li key={m.id} className={styles.measureItem}>
                      <div className={styles.measureDescription}>{m.description}</div>
                      <div className={styles.measureTarget}>
                        {m.target ? `Target: ${m.target}` : "No target"}
                      </div>
                      <div className={styles.measureValue}>
                        {formatValue(m.value_type, latest?.value_number ?? null, latest?.value_text ?? null)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.emptyLine}>No measures yet.</p>
            )}

            {isAdmin ? (
              <details className={styles.addDetails}>
                <summary className={styles.addSummary}>+ Add measure</summary>
                <AddMeasureForm outcomeId={o.id} />
              </details>
            ) : null}
          </article>
        ))}

        {detail.outcomes.length === 0 ? (
          <p className={styles.emptyLine}>No outcomes yet.</p>
        ) : null}

        {isAdmin ? (
          <details className={styles.addDetails}>
            <summary className={styles.addSummary}>+ Add outcome</summary>
            <AddOutcomeForm functionId={detail.fn.id} />
          </details>
        ) : null}
      </section>

      {detail.children.length > 0 ? (
        <section>
          <h2 className={styles.outcomeTitle}>Sub-functions</h2>
          <ul className={styles.outcomeList}>
            {detail.children.map((c) => (
              <li key={c.id} className={styles.outcomeItem}>
                <Link href={`/chart/function/${c.id}`} className={styles.functionTitle}>
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function formatValue(
  valueType: "number" | "percent" | "text",
  n: number | null,
  t: string | null
): React.ReactNode {
  if (valueType === "text") return t ?? "—";
  if (n === null || !Number.isFinite(n)) return "—";
  if (valueType === "percent") return `${n}%`;
  return n.toString();
}
